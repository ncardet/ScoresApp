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
//
// Schema 2 (pre-game predictions): the window is games starting 7 am today to 3 am tomorrow PT;
// top games are ranked by Watch Priority (at most 2 per league); plus Sleeper, Skip and Coming up.
// Predictions start from the nightly data/predictions.json (Elo, season simulation, injuries,
// weather) and are re-run here against the scoreboard's current odds.

import { readFile, writeFile, mkdir, readdir, unlink } from 'node:fs/promises';
import { appendFileSync } from 'node:fs';
import { ADAPTERS } from '../site/js/adapters/index.js';
import { mapLimit } from '../site/js/adapters/espn/client.js';
import { LEAGUES, LEAGUE_BY_KEY } from '../site/js/core/leagues.js';
import { todayKey, addDays, ptParts, ptTime, formatTime, longDayLabel, TZ } from '../site/js/core/time.js';
import { whereToWatch } from '../site/js/core/watch.js';
import { MY_SERVICES } from '../site/config/services.js';
import FAVORITES from '../site/config/favorites.js';
import CFG from '../site/config/prediction.json' with { type: 'json' };
import { getCalibration, predict, rate, ENGINE_VERSION } from '../site/js/rating/index.js';
import { watchPriority, PREDICTION_VERSION } from '../site/js/predict/index.js';

export const SCHEMA_VERSION = 2;
const OUT = 'site/data';
const B = CFG.brief;
const REPLAY_GREAT_MAX = 8;
const REPLAY_FALLBACK = 5;
const COMING_UP_MAX = 6;
const KEEP_RATINGS_DAYS = 14;

const args = process.argv.slice(2);
const FORCE = args.includes('--force');
const dateArg = args.includes('--date') ? args[args.indexOf('--date') + 1] : null;
const SITE_URL = process.env.SITE_URL ? process.env.SITE_URL.replace(/\/?$/, '/') : '';

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
const favoriteOf = (g) => (g.home ? FAVORITES.find((f) => f.leagues.includes(g.league) && (String(f.id) === g.home.id || String(f.id) === g.away.id)) : null) || null;
const r2 = (x) => (Number.isFinite(x) ? Math.round(x * 100) / 100 : null);

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

const gameUrl = (g) => (SITE_URL ? `${SITE_URL}#/game/${g.league}/${encodeURIComponent(g.id)}${g.eventId ? `?e=${g.eventId}` : ''}` : null);

/** Watch Priority for any rating state (predictions carry their own). */
function priorityOf(g, rating) {
  if (!rating) return null;
  if (rating.pred) return rating.pred.priority;
  return watchPriority(g, rating.value, { favorites: FAVORITES }).value;
}

function entry(g, rating, { replay = false } = {}) {
  const lg = LEAGUE_BY_KEY[g.league];
  const p = rating?.pred || null;
  const fav = favoriteOf(g);
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
    rating_low: p?.low ?? null,
    rating_high: p?.high ?? null,
    p_great: p ? r2(p.pGreat) : null,
    p_dull: p ? r2(p.pDull) : null,
    horizon: p?.horizon?.label ?? null,
    watch_priority: priorityOf(g, rating),
    reason: rating?.explain || '',
    reasons: (rating?.reasons || []).slice(0, 3).map((r) => r.text),
    favorite: !!fav,
    favorite_team: fav?.name ?? null,
    ...watch(g),
    url: gameUrl(g),
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

/** The nightly predictions file: per-game inputs (Elo, importance, injuries, weather) and circle flags. */
async function loadPredictions(errors) {
  try {
    const data = JSON.parse(await readFile(`${OUT}/predictions.json`, 'utf8'));
    return { data, map: new Map((data.games || []).map((g) => [g.key, g])) };
  } catch (e) {
    errors.push(`predictions.json: ${e.code === 'ENOENT' ? 'missing (predicting from odds only)' : e.message}`);
    return { data: null, map: new Map() };
  }
}

async function predicted(g, preds) {
  if (g.sport === 'racing' && !g.isRace) return null;
  const cal = await getCalibration(g.league);
  const entryFor = preds.map.get(g.key);
  return predict(g, cal, { ...(entryFor?.inputs || {}), favorites: FAVORITES });
}

async function current(g, preds, errors) {
  try {
    const detail = await ADAPTERS[g.league].summary(g, { standings: true });
    const cal = await getCalibration(g.league);
    return rate(detail, cal, { predicted: await predicted(g, preds) });
  } catch (e) {
    errors.push(`${g.key}: ${e.message}`);
    return null;
  }
}

const NATIONAL = /^(ABC|ESPN|ESPN2|TNT|TBS|truTV|NBC|CBS|FOX|FS1|Prime Video|Peacock|Netflix|NBA TV|NFL Network|MLB Network|NHL Network|Apple TV|HBO Max|USA)$/i;

/** How much attention a game would get on name alone: favorite, star power, national TV, ranked. */
export function profileScore(g, pred) {
  let s = 0;
  for (const part of pred?.priorityParts || []) s += part.label === 'Favorite' ? 3 : part.points >= 2 ? 2 : 1;
  if ((g.broadcasts || []).some((b) => b.market === 'national' && NATIONAL.test(b.name))) s += 1;
  if (LEAGUE_BY_KEY[g.league]?.college && ((g.home?.rank && g.home.rank <= 10) || (g.away?.rank && g.away.rank <= 10))) s += 1;
  return s;
}

/** "Lakers −14: blowout risk", or the largest negative reason. */
export function skipWarning(g, pred) {
  const neg = [...(pred.terms || [])].filter((t) => t.points < 0 && t.text).sort((a, b) => a.points - b.points)[0];
  // A lopsided spread is the usual culprit: say it the way a fan would ("Lakers −14: blowout risk").
  if (neg?.key === 'closeness' && neg.spread != null && pred.probs?.home != null) {
    const side = pred.probs.home >= pred.probs.away ? 'home' : 'away';
    return `${g[side]?.short || 'Favorite'} −${String(neg.spread).replace(/\.0$/, '')}: blowout risk`;
  }
  return neg ? neg.text : `Projects ${pred.value}`;
}

/**
 * Brief sections from the day's rated games (pure, for tests).
 * `rated` = [{ g, r }] for games inside the window; r may be predicted, live or final.
 */
export function selectSections(rated, { topN = B.topN, perLeagueMax = B.perLeagueMax } = {}) {
  // Finished games and live games that are already Dull aren't picks.
  const upcoming = rated.filter(({ g, r }) => r && g.state !== 'post' && !g.canceled && (g.sport !== 'racing' || g.isRace) && !(g.state === 'in' && r.value < 40));
  const pre = upcoming.filter(({ g, r }) => g.state === 'pre' && r.pred);

  // Skip: the most high-profile game that projects Dull. Chosen first so it is never also a pick.
  const skipCands = pre
    .map((x) => ({ ...x, profile: profileScore(x.g, x.r.pred) }))
    .filter(({ r, profile }) => profile >= 2 && (r.pred.value < B.skipMaxValue || r.pred.pDull >= B.skipMinPDull))
    .sort((a, b) => b.profile - a.profile || b.r.pred.pDull - a.r.pred.pDull);
  const skip = skipCands[0] || null;

  const ranked = upcoming
    .filter((x) => x !== skip && x.g.key !== skip?.g.key)
    .map((x) => ({ ...x, priority: priorityOf(x.g, x.r) ?? x.r.value }))
    .sort((a, b) => b.priority - a.priority || b.r.value - a.r.value || (b.r.pred?.pGreat ?? 0) - (a.r.pred?.pGreat ?? 0));
  const top = [];
  const perLeague = new Map();
  for (const x of ranked) {
    const n = perLeague.get(x.g.league) || 0;
    if (n >= perLeagueMax) continue;
    perLeague.set(x.g.league, n + 1);
    top.push(x);
    if (top.length >= topN) break;
  }
  const inTop = new Set(top.map((x) => x.g.key));
  const sleeper = pre
    .filter((x) => !inTop.has(x.g.key) && x.g.key !== skip?.g.key)
    .sort((a, b) => b.r.pred.pGreat - a.r.pred.pGreat)[0] || null;
  return { top, sleeper, skip };
}

/** New "Circle this one" flags since the previous brief. */
function comingUp(preds, today, prevBrief) {
  if (!preds.data) return [];
  const already = new Set((prevBrief?.coming_up || []).map((c) => c.id));
  const since = addDays(today, -1);
  const flagged = [
    ...(preds.data.circle || []),
    ...(preds.data.games || []).filter((g) => g.pred?.circle?.flagged && g.day > addDays(today, 1)).map((g) => ({ ...g, reasons: g.pred.circle.reasons })),
  ];
  return flagged
    .filter((c) => c.flaggedAt && c.flaggedAt >= since && !already.has(c.key))
    .sort((a, b) => (a.start < b.start ? -1 : 1))
    .slice(0, COMING_UP_MAX)
    .map((c) => {
      const lg = LEAGUE_BY_KEY[c.league];
      const soccer = lg?.sport === 'soccer';
      const m = c.home && c.away ? (soccer ? `${c.home.short} vs ${c.away.short}` : `${c.away.short} at ${c.home.short}`) : (c.gpName || 'Race');
      return {
        id: c.key, league: lg?.short || c.league, league_key: c.league, matchup: m,
        date: c.day, day_label: longDayLabel(c.day), start_time_pt: formatTime(c.start), start_iso: c.start,
        reasons: c.reasons || [], flagged_on: c.flaggedAt,
        url: SITE_URL ? `${SITE_URL}#/ahead` : null,
      };
    });
}

function markdown(brief) {
  const L = [];
  const pct = (x) => `${Math.round(x * 100)}%`;
  const rating = (e) => {
    if (e.rating == null) return 'Not rated';
    if (e.rating_state === 'predicted') return `**${e.rating} ${e.band}** (likely ${e.rating_low}–${e.rating_high} · ${pct(e.p_great)} chance of Great)`;
    return `**${e.rating} ${e.band}** (${e.rating_state})`;
  };
  const when = (e) => (e.status === 'scheduled' ? `${e.start_time_pt} PT` : e.status_detail);
  L.push(`# Sideline brief — ${longDayLabel(brief.date)}`, '',
    `_Generated ${brief.generated_at_pt}. Games starting ${brief.window.start_pt} today to ${brief.window.end_pt} tomorrow, Pacific._`, '');
  L.push("## Today's top games", '');
  if (!brief.top_games.length) L.push('No rated games in the window.', '');
  brief.top_games.forEach((e, i) => {
    L.push(`${i + 1}. ${rating(e)} · ${e.favorite ? '★ ' : ''}${e.league} · ${e.matchup} · ${when(e)} · ${e.watch_summary}`);
    if (e.reason) L.push(`   ${e.reason}`);
  });
  L.push('', '## Favorites today', '');
  if (!brief.favorites_today.length) L.push('No favorites play today.');
  for (const e of brief.favorites_today) {
    const r = e.rating == null ? '' : e.rating_state === 'predicted' ? ` · predicted ${e.rating} (likely ${e.rating_low}–${e.rating_high})` : ` · ${e.rating_state} ${e.rating} (${e.band})`;
    L.push(`- ★ ${e.favorite_team} · ${e.league} · ${e.matchup} · ${when(e)} · ${e.watch_summary}${r}${e.final_score ? ` · ${e.final_score}` : ''}`);
  }
  L.push('', '## Sleeper', '');
  if (brief.sleeper) {
    const e = brief.sleeper;
    L.push(`${e.league} · ${e.matchup} · ${when(e)} · ${e.watch_summary}: ${pct(e.p_great)} chance of Great (predicted ${e.rating}, likely ${e.rating_low}–${e.rating_high}).${e.reason ? ` ${e.reason}.` : ''}`);
  } else L.push('No sleeper today.');
  if (brief.skip) {
    const e = brief.skip;
    L.push('', '## Skip', '', `${e.league} · ${e.matchup} · ${when(e)}: ${e.warning} (predicted ${e.rating}, ${pct(e.p_dull)} chance of Dull).`);
  }
  L.push('', `## Worth a replay (${longDayLabel(brief.replay_date)})`, '');
  if (!brief.worth_a_replay.length) L.push('Nothing finished yesterday worth a replay.');
  brief.worth_a_replay.forEach((e, i) => {
    L.push(`${i + 1}. ${rating(e)} · ${e.league} · ${e.matchup} · ${e.final_score}`);
    if (e.reason) L.push(`   ${e.reason}`);
  });
  if (brief.coming_up.length) {
    L.push('', '## Coming up', '');
    for (const c of brief.coming_up) L.push(`- ◎ ${c.league} · ${c.day_label} · ${c.matchup}: ${c.reasons.join(' · ')}`);
  }
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
  const tomorrow = addDays(today, 1);
  const winStart = ptTime(today, B.windowStartHour);
  const winEnd = ptTime(tomorrow, B.windowEndHour);
  const dayStart = ptTime(today, 0);
  const errors = [];
  let prevBrief = null;
  try { prevBrief = JSON.parse(await readFile(`${OUT}/brief.json`, 'utf8')); } catch { /* first brief */ }
  const preds = await loadPredictions(errors);
  if (preds.data?.date && preds.data.date < yesterday) errors.push(`predictions.json is from ${preds.data.date}; using it anyway`);

  // ESPN's scoreboard days don't line up with Pacific days at night, so load both and filter by time.
  const [d0, d1, yGames] = await Promise.all([loadDay(today, errors), loadDay(tomorrow, errors), loadDay(yesterday, errors)]);
  const byKey = new Map([...d0, ...d1].map((g) => [g.key, g]));
  const at = (g) => new Date(g.start).getTime();
  const inWindow = [...byKey.values()].filter((g) => !g.canceled && at(g) >= winStart.getTime() && at(g) < winEnd.getTime());
  const favGames = [...byKey.values()].filter((g) => favoriteOf(g) && at(g) >= dayStart.getTime() && at(g) < winEnd.getTime());

  const rateOne = async (g) => {
    let r = await predicted(g, preds).catch((e) => { errors.push(`${g.key} predict: ${e.message}`); return null; });
    if (g.state !== 'pre' && (g.sport !== 'racing' || g.isRace)) r = (await current(g, preds, errors)) || r;
    return { g, r };
  };
  const rated = await mapLimit(inWindow, 6, rateOne);
  const ratedKeys = new Map(rated.map((x) => [x.g.key, x]));
  const favRated = await mapLimit(favGames, 4, async (g) => ratedKeys.get(g.key) || rateOne(g));

  const { top, sleeper, skip } = selectSections(rated);
  const favorites = favRated
    .sort((a, b) => new Date(a.g.start) - new Date(b.g.start))
    .map(({ g, r }) => entry(g, r));

  // Yesterday: final ratings for every finished game.
  const finals = yGames.filter((g) => g.state === 'post' && !g.canceled && (g.sport !== 'racing' || g.isRace));
  const yRated = (await mapLimit(finals, 6, async (g) => ({ g, r: await current(g, preds, errors) }))).filter((x) => x.r && x.r.state === 'final');
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
    prediction_version: PREDICTION_VERSION,
    predictions_date: preds.data?.date ?? null,
    app_url: SITE_URL || null,
    window: { start: winStart.toISOString(), end: winEnd.toISOString(), start_pt: formatTime(winStart.toISOString()), end_pt: formatTime(winEnd.toISOString()) },
    top_games: top.map(({ g, r }) => entry(g, r)),
    favorites_today: favorites,
    sleeper: sleeper ? entry(sleeper.g, sleeper.r) : null,
    skip: skip ? { ...entry(skip.g, skip.r), warning: skipWarning(skip.g, skip.r.pred) } : null,
    worth_a_replay: replay,
    coming_up: comingUp(preds, today, prevBrief),
    counts: { games_in_window: inWindow.length, rated_in_window: rated.filter((x) => x.r).length, finished_yesterday: finals.length, rated_yesterday: yRated.length },
    errors: errors.slice(0, 50),
  };

  await mkdir(`${OUT}/ratings`, { recursive: true });
  await writeFile(`${OUT}/brief.json`, `${JSON.stringify(brief, null, 2)}\n`);
  await writeFile(`${OUT}/brief.md`, markdown(brief));
  // Yesterday's final ratings, so the app can show them without re-fetching every game.
  const ratings = Object.fromEntries(yRated.map(({ g, r }) => [g.key, { ...r, curve: undefined, wp: undefined, scores: undefined }]));
  await writeFile(`${OUT}/ratings/${yesterday}.json`, JSON.stringify({ date: yesterday, engine: ENGINE_VERSION, ratings }));
  await pruneRatings(`${OUT}/ratings`);
  console.log(`Brief for ${today}: ${brief.top_games.length} top games, ${favorites.length} favorite games, sleeper ${brief.sleeper ? 'yes' : 'no'}, skip ${brief.skip ? 'yes' : 'no'}, ${replay.length} replays (${yRated.length}/${finals.length} rated yesterday), ${brief.coming_up.length} coming up. ${errors.length} errors.`);
  if (errors.length) console.log(errors.slice(0, 10).join('\n'));
  setOutput('generated', 'true');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
}
