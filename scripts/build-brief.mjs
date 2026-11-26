#!/usr/bin/env node
// Morning brief: writes site/data/brief.json, site/data/brief.md and site/data/ratings/<yesterday>.json.
//
//   node scripts/build-brief.mjs            # only runs 4:00-9:59 am Pacific, once per day
//   node scripts/build-brief.mjs --force    # run now regardless
//   node scripts/build-brief.mjs --force --date 2026-11-27
//
// GitHub Actions cron runs in UTC, so the workflow schedules two runs (12:50 and 13:50 UTC);
// this script exits early unless it is morning in Los Angeles and today's brief is missing,
// which makes it daylight-saving-proof. See BRIEF_FEED.md for the schema.

import { readFile, writeFile, mkdir, readdir, unlink } from 'node:fs/promises';
import { appendFileSync } from 'node:fs';
import { ADAPTERS } from '../site/js/adapters/index.js';
import { mapLimit } from '../site/js/adapters/espn/client.js';
import { LEAGUES, LEAGUE_BY_KEY } from '../site/js/core/leagues.js';
import { todayKey, addDays, ptParts, formatTime, longDayLabel, TZ } from '../site/js/core/time.js';
import { whereToWatch } from '../site/js/core/watch.js';
import { MY_SERVICES } from '../site/config/services.js';
import FAVORITES from '../site/config/favorites.js';
import { getCalibration, predict, rate, predictF1, ENGINE_VERSION } from '../site/js/rating/index.js';

export const SCHEMA_VERSION = 1;
const OUT = 'site/data';
const TOP_N = 5;
const REPLAY_GREAT_MAX = 8;
const REPLAY_FALLBACK = 5;
const KEEP_RATINGS_DAYS = 14;

const args = process.argv.slice(2);
const FORCE = args.includes('--force');
const dateArg = args.includes('--date') ? args[args.indexOf('--date') + 1] : null;
const SITE_URL = (process.env.SITE_URL || '').replace(/\/?$/, '/');

function setOutput(name, value) {
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
}

/** Morning window in Los Angeles, and today's brief not already written. */
export async function shouldRun(now = new Date(), existingPath = `${OUT}/brief.json`) {
  const { hour } = ptParts(now);
  if (hour < 4 || hour > 9) return { run: false, why: `It is ${hour}:00 in Los Angeles; the brief runs 4-9 am.` };
  try {
    const prev = JSON.parse(await readFile(existingPath, 'utf8'));
    if (prev.date === todayKey(now) && prev.scheduled) return { run: false, why: `Today's brief (${prev.date}) already exists.` };
  } catch { /* no previous brief */ }
  return { run: true };
}

const favIds = (league) => FAVORITES.filter((f) => f.leagues.includes(league)).map((f) => String(f.id));
const isFavorite = (g) => !!g.home && FAVORITES.some((f) => f.leagues.includes(g.league) && (String(f.id) === g.home.id || String(f.id) === g.away.id));

function matchup(g) {
  if (g.sport === 'racing') return `${g.gpName} · ${g.sessionLabel}`;
  return g.sport === 'soccer' ? `${g.home.short} vs ${g.away.short}` : `${g.away.short} at ${g.home.short}`;
}

function finalScore(g) {
  if (g.sport === 'racing') return g.drivers?.[0] ? `Winner: ${g.drivers[0].name}` : '';
  const [a, b] = g.sport === 'soccer' ? [g.home, g.away] : [g.away, g.home];
  const extra = /OT|SO|AET|PEN|\/\d+/.test(g.detail || '') ? ` (${g.detail.replace(/^Final\/?/, '').replace(/^FT-?/, '') || g.detail})` : '';
  return `${a.short} ${a.score}, ${b.short} ${b.score}${extra}`;
}

function watch(g) {
  const w = whereToWatch(g.broadcasts, MY_SERVICES);
  if (w.status === 'ok') {
    const opts = w.options.map((o) => (o.services.length === 1 && o.services[0] === o.network ? o.network : `${o.network} (${o.services.join(', ')})`));
    return { watch: opts, watch_summary: opts[0] };
  }
  if (w.status === 'none') return { watch: [], watch_summary: 'Not on your services' };
  return { watch: [], watch_summary: 'No TV listing' };
}

function entry(g, rating, { replay = false } = {}) {
  const lg = LEAGUE_BY_KEY[g.league];
  const base = {
    id: g.key,
    league: lg.short,
    league_key: g.league,
    matchup: matchup(g),
    home: g.home?.name ?? null,
    away: g.away?.name ?? null,
    start_time_pt: formatTime(g.start),
    start_iso: g.start,
    status: g.canceled ? 'canceled' : g.state === 'pre' ? 'scheduled' : g.state === 'in' ? 'live' : 'final',
    status_detail: g.state === 'pre' ? `${formatTime(g.start)} PT` : g.detail,
    rating: rating?.value ?? null,
    rating_state: rating?.state ?? null,
    band: rating?.band?.label ?? null,
    reason: rating?.explain || '',
    favorite: isFavorite(g),
    ...watch(g),
    url: SITE_URL ? `${SITE_URL}#/game/${g.league}/${encodeURIComponent(g.id)}${g.eventId ? `?e=${g.eventId}` : ''}` : null,
  };
  if (replay || g.state === 'post') base.final_score = finalScore(g);
  return base;
}

async function loadDay(dateKey, errors) {
  const out = [];
  await mapLimit(LEAGUES, 6, async (lg) => {
    try {
      const res = await ADAPTERS[lg.key].scoreboard(dateKey, { favoriteTeamIds: favIds(lg.key) });
      out.push(...res.games);
    } catch (e) {
      errors.push(`${lg.key} ${dateKey}: ${e.message}`);
    }
  });
  return out;
}

let f1Standings;
async function predicted(g) {
  const cal = await getCalibration(g.league);
  if (g.sport === 'racing') {
    if (!g.isRace) return null;
    if (f1Standings === undefined) f1Standings = await ADAPTERS.f1.standings().catch(() => null);
    return predictF1(g, cal, f1Standings);
  }
  return predict(g, cal);
}

async function current(g, errors) {
  try {
    const detail = await ADAPTERS[g.league].summary(g, { standings: true });
    const cal = await getCalibration(g.league);
    return rate(detail, cal, { predicted: await predicted(g) });
  } catch (e) {
    errors.push(`${g.key}: ${e.message}`);
    return null;
  }
}

function markdown(brief) {
  const L = [];
  const fmt = (e) => {
    const r = e.rating != null ? `**${e.rating} ${e.band}**${e.rating_state === 'predicted' ? ' (predicted)' : e.rating_state === 'live' ? ' (live)' : ''}` : 'Not rated';
    return `${r} · ${e.league} · ${e.matchup}`;
  };
  L.push(`# Sideline brief — ${longDayLabel(brief.date)}`, '', `_Generated ${brief.generated_at_pt}. Times are Pacific._`, '');
  L.push("## Today's top games", '');
  if (!brief.top_games.length) L.push('No rated games today.', '');
  brief.top_games.forEach((e, i) => {
    L.push(`${i + 1}. ${fmt(e)} · ${e.status === 'scheduled' ? `${e.start_time_pt} PT` : e.status_detail} · ${e.watch_summary}`);
    if (e.reason) L.push(`   ${e.reason}`);
  });
  L.push('', '## Favorites today', '');
  if (!brief.favorites_today.length) L.push('No favorites play today.');
  for (const e of brief.favorites_today) {
    L.push(`- ★ ${e.league} · ${e.matchup} · ${e.status === 'scheduled' ? `${e.start_time_pt} PT` : e.status_detail} · ${e.watch_summary}${e.rating != null ? ` · ${e.rating_state === 'final' ? 'rated' : 'predicted'} ${e.rating} (${e.band})` : ''}`);
  }
  L.push('', `## Worth a replay (${longDayLabel(brief.replay_date)})`, '');
  if (!brief.worth_a_replay.length) L.push('Nothing finished yesterday worth a replay.');
  brief.worth_a_replay.forEach((e, i) => {
    L.push(`${i + 1}. ${fmt(e)} · ${e.final_score}`);
    if (e.reason) L.push(`   ${e.reason}`);
  });
  L.push('', `Open the app: ${brief.app_url || '(set SITE_URL)'}`);
  return `${L.join('\n')}\n`;
}

async function pruneRatings(dir) {
  const files = (await readdir(dir).catch(() => [])).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
  for (const f of files.slice(0, Math.max(0, files.length - KEEP_RATINGS_DAYS))) await unlink(`${dir}/${f}`).catch(() => {});
}

async function main() {
  const now = new Date();
  if (!FORCE) {
    const gate = await shouldRun(now);
    if (!gate.run) {
      console.log(`Skipping: ${gate.why}`);
      setOutput('generated', 'false');
      return;
    }
  }
  const today = dateArg || todayKey(now);
  const yesterday = addDays(today, -1);
  const errors = [];
  const [todayGames, yGames] = await Promise.all([loadDay(today, errors), loadDay(yesterday, errors)]);

  // Today: predicted ratings (live/final games get their current rating).
  const todayRated = await mapLimit(todayGames.filter((g) => !g.canceled), 6, async (g) => {
    let r = await predicted(g).catch(() => null);
    if (g.state !== 'pre' && (g.sport !== 'racing' || g.isRace)) r = (await current(g, errors)) || r;
    return { g, r };
  });
  const rankable = todayRated.filter(({ g, r }) => r && g.state !== 'post' && (g.sport !== 'racing' || g.isRace));
  rankable.sort((a, b) => b.r.value - a.r.value);
  const top = rankable.slice(0, TOP_N).map(({ g, r }) => entry(g, r));
  const favorites = todayRated
    .filter(({ g }) => isFavorite(g))
    .sort((a, b) => new Date(a.g.start) - new Date(b.g.start))
    .map(({ g, r }) => entry(g, r));

  // Yesterday: final ratings for every finished game.
  const finals = yGames.filter((g) => g.state === 'post' && !g.canceled && (g.sport !== 'racing' || g.isRace));
  const yRated = (await mapLimit(finals, 6, async (g) => ({ g, r: await current(g, errors) }))).filter((x) => x.r && x.r.state === 'final');
  yRated.sort((a, b) => b.r.value - a.r.value);
  const great = yRated.filter((x) => x.r.value >= 85);
  const replay = (great.length >= 3 ? great.slice(0, REPLAY_GREAT_MAX) : yRated.slice(0, REPLAY_FALLBACK)).map(({ g, r }) => entry(g, r, { replay: true }));

  const p = ptParts(now);
  const brief = {
    schema_version: SCHEMA_VERSION,
    generated_at: now.toISOString(),
    generated_at_pt: `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')} ${formatTime(now.toISOString())} PT`,
    timezone: TZ,
    date: today,
    replay_date: yesterday,
    scheduled: !FORCE,
    engine_version: ENGINE_VERSION,
    app_url: SITE_URL || null,
    top_games: top,
    favorites_today: favorites,
    worth_a_replay: replay,
    counts: { games_today: todayGames.length, finished_yesterday: finals.length, rated_yesterday: yRated.length },
    errors: errors.slice(0, 50),
  };

  await mkdir(`${OUT}/ratings`, { recursive: true });
  await writeFile(`${OUT}/brief.json`, `${JSON.stringify(brief, null, 2)}\n`);
  await writeFile(`${OUT}/brief.md`, markdown(brief));
  // Yesterday's final ratings, so the app can show them without re-fetching every game.
  const ratings = Object.fromEntries(yRated.map(({ g, r }) => [g.key, { ...r, curve: undefined, wp: undefined, scores: undefined }]));
  await writeFile(`${OUT}/ratings/${yesterday}.json`, JSON.stringify({ date: yesterday, engine: ENGINE_VERSION, ratings }));
  await pruneRatings(`${OUT}/ratings`);
  console.log(`Brief for ${today}: ${top.length} top games, ${favorites.length} favorite games, ${replay.length} replays (${yRated.length}/${finals.length} rated yesterday). ${errors.length} errors.`);
  if (errors.length) console.log(errors.slice(0, 10).join('\n'));
  setOutput('generated', 'true');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
}
