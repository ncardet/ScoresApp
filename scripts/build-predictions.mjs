#!/usr/bin/env node
// Nightly predictions: site/data/predictions.json (next 14 days, every league) and
// site/data/elo/<league>.json. Runs ~2am Pacific from .github/workflows/predictions.yml.
//
//   node scripts/build-predictions.mjs            # only 1-4 am Pacific, once per day
//   node scripts/build-predictions.mjs --force
//
// Steps per league: refresh results -> Elo -> season simulation (10,000 runs) -> importance ->
// injuries / leaders for games in the next 2 days -> predictGame() for every game in 14 days,
// plus "Circle this one" flags up to 60 days out. F1: standings, qualifying, race-hour rain.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { appendFileSync } from 'node:fs';
import CFG from '../site/config/prediction.json' with { type: 'json' };
import FAVORITES from '../site/config/favorites.js';
import { ADAPTERS } from '../site/js/adapters/index.js';
import { getJson, mapLimit } from '../site/js/adapters/espn/client.js';
import { parseOdds } from '../site/js/adapters/espn/parse.js';
import { LEAGUE_BY_KEY } from '../site/js/core/leagues.js';
import { addDays, todayKey, ptParts, ptDateKey } from '../site/js/core/time.js';
import { predictGame, PREDICTION_VERSION, isPlayoff } from '../site/js/predict/index.js';
import { simulateSeason, standingsFrom, countsInStandings, FORMATS, seededRng } from '../site/js/predict/simulate.js';
import { leagueHistory, SEASONS } from './lib/history.mjs';
import { walk } from './lib/elo-walk.mjs';
import { scoringStyle } from '../site/js/predict/style.js';
import { leagueStructure } from './lib/structure.mjs';
import { displayable, toGame } from './backfill-targets.mjs';

const args = process.argv.slice(2);
const FORCE = args.includes('--force');
const ONLY = args.includes('--leagues') ? args[args.indexOf('--leagues') + 1].split(',') : null;
const RUNS = args.includes('--runs') ? +args[args.indexOf('--runs') + 1] : 10000;
const HORIZON_DAYS = 14;
const CIRCLE_DAYS = 60;
const OUT = 'site/data';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function setOutput(name, value) {
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
}

export async function shouldRun(now = new Date(), path = `${OUT}/predictions.json`) {
  const { hour } = ptParts(now);
  if (hour < 1 || hour > 4) return { run: false, why: `It is ${hour}:00 in Los Angeles; predictions run 1-4 am.` };
  try {
    const prev = JSON.parse(await readFile(path, 'utf8'));
    if (prev.date === todayKey(now) && prev.scheduled) return { run: false, why: 'Already generated today.' };
  } catch { /* none yet */ }
  return { run: true };
}

const r1 = (x) => (Number.isFinite(x) ? Math.round(x * 10) / 10 : x);

// ---------- availability (injuries + season leaders), next 2 days ----------

async function availability(league, game) {
  const fam = league === 'nfl' ? 'nfl' : ['nba', 'wnba', 'mcbb', 'wcbb'].includes(league) ? 'bball' : null;
  if (!fam) return null;
  const a = ADAPTERS[league];
  const res = await getJson(a.urls.summary(game.id), { retries: 1, timeout: 15000 }).catch(() => null);
  const j = res?.json;
  if (!j) return null;
  const out = {};
  // Outdoor NFL forecast: gusts (mph) from ESPN's AccuWeather block.
  const gust = Number(j.gameInfo?.weather?.gust);
  if (fam === 'nfl' && Number.isFinite(gust) && j.gameInfo?.venue?.indoor !== true) out.windGust = gust;
  const sideOf = (teamId) => (String(teamId) === game.home.id ? 'home' : String(teamId) === game.away.id ? 'away' : null);
  const leaderOf = {};
  for (const t of j.leaders || []) {
    const side = sideOf(t.team?.id);
    if (!side) continue;
    const cat = (t.leaders || []).find((c) => (fam === 'nfl' ? /passing/i : /points/i).test(c.name || ''));
    leaderOf[side] = cat?.leaders?.[0]?.athlete?.displayName || null;
  }
  for (const t of j.injuries || []) {
    const side = sideOf(t.team?.id);
    if (!side || !leaderOf[side]) continue;
    for (const inj of t.injuries || []) {
      const name = inj.athlete?.displayName;
      const status = String(inj.status || inj.type?.description || '');
      if (name === leaderOf[side] && /out|doubtful/i.test(status)) {
        if (fam === 'nfl') (out.qbOut ||= {})[side] = name;
        else (out.starOut ||= {})[side] = name;
      }
    }
  }
  return Object.keys(out).length ? out : null;
}

// ---------- NHL: each team's usual starting goalie (last 3 weeks of scoreboards) ----------

/** Team id -> goalie who started at least 60% of its recent games (null for a tandem). */
async function usualGoalies(today, days = 21) {
  const starts = new Map();
  for (let i = 1; i <= days; i++) {
    const res = await ADAPTERS.nhl.scoreboard(addDays(today, -i)).catch(() => null);
    for (const g of res?.games || []) {
      if (g.state !== 'post') continue;
      for (const t of [g.home, g.away]) {
        if (!t?.probable?.name) continue;
        const m = starts.get(t.id) || new Map();
        m.set(t.probable.name, (m.get(t.probable.name) || 0) + 1);
        starts.set(t.id, m);
      }
    }
  }
  const out = new Map();
  for (const [id, m] of starts) {
    const total = [...m.values()].reduce((a, b) => a + b, 0);
    const [name, n] = [...m.entries()].sort((a, b) => b[1] - a[1])[0];
    if (total >= 4 && n / total >= 0.6) out.set(id, name);
  }
  return out;
}

// ---------- F1 ----------

function coordsFor(circuit) {
  for (const [k, v] of Object.entries(CFG.f1Coords || {})) if (k !== '_doc' && circuit.includes(k)) return v;
  return null;
}

async function rainAt(circuit, startIso) {
  const c = coordsFor(circuit);
  if (!c) return null;
  const days = Math.ceil((new Date(startIso) - Date.now()) / 86400000) + 1;
  if (days > 16 || days < 0) return null;
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${c[0]}&longitude=${c[1]}&hourly=precipitation_probability&forecast_days=${Math.min(16, Math.max(1, days + 1))}&timezone=UTC`;
  const res = await getJson(url, { retries: 1 }).catch(() => null);
  const h = res?.json?.hourly;
  if (!h) return null;
  const start = new Date(startIso).getTime();
  let p = null;
  h.time.forEach((t, i) => {
    const ts = new Date(`${t}:00Z`).getTime();
    if (ts >= start - 3600e3 && ts <= start + 2 * 3600e3) p = Math.max(p ?? 0, h.precipitation_probability[i] ?? 0);
  });
  if (p == null) return null;
  // Forecasts more than a week out are weak: count them half.
  const weak = days > 7;
  return { prob: (p / 100) * (weak ? 0.5 : 1), raw: p / 100, weak };
}

async function openf1(path) {
  await sleep(1200);
  return (await getJson(`https://api.openf1.org/v1/${path}`, { retries: 2, timeout: 20000 }).catch(() => null))?.json;
}

async function f1Predictions(today, favorites) {
  const out = [];
  const days = Array.from({ length: HORIZON_DAYS + 1 }, (_, i) => addDays(today, i));
  const seen = new Set();
  const standings = await ADAPTERS.f1.standings().catch(() => null);
  const drivers = standings?.groups?.find((g) => /driver/i.test(g.name))?.rows || [];
  const p1 = drivers[0]?.stats?.championshipPts?.v;
  const p2 = drivers[1]?.stats?.championshipPts?.v;
  const titleGap = p1 != null && p2 != null ? p1 - p2 : null;
  for (const d of days) {
    const res = await ADAPTERS.f1.scoreboard(d).catch(() => null);
    for (const g of res?.games || []) {
      if (!g.isRace || seen.has(g.key) || g.state !== 'pre') continue;
      seen.add(g.key);
      const extras = {};
      const races = 26;
      if (titleGap != null && titleGap <= races) extras.titleGap = titleGap;
      const rain = await rainAt(`${g.circuit} ${g.gpName}`, g.start);
      if (rain) { extras.rainProb = rain.prob; extras.rainWeak = rain.weak; }
      // Qualifying (if already run): grid gaps and contenders starting deep.
      const year = new Date(g.start).getUTCFullYear();
      const sessions = await openf1(`sessions?year=${year}`);
      const q = (sessions || []).filter((s) => s.session_name === 'Qualifying' && Math.abs(new Date(s.date_start) - new Date(g.start)) < 4 * 86400000).at(-1);
      if (q && new Date(q.date_end) < new Date()) {
        const qr = await openf1(`session_result?session_key=${q.session_key}`);
        const best = (r) => (Array.isArray(r.duration) ? r.duration.filter(Number.isFinite).at(-1) : r.duration);
        const qs = (qr || []).filter((r) => r.position).sort((a, b) => a.position - b.position);
        if (qs.length > 1 && best(qs[0]) && best(qs[1])) {
          extras.qualiGap = best(qs[1]) - best(qs[0]);
          extras.poleMargin = extras.qualiGap;
        }
        const ds = await openf1(`drivers?session_key=${q.session_key}`);
        const byNum = new Map((ds || []).map((x) => [x.driver_number, x]));
        const contenders = drivers.slice(0, 2).map((r) => (r.team?.name || '').split(' ').at(-1).toLowerCase());
        for (const r of qs) {
          const name = (byNum.get(r.driver_number)?.last_name || '').toLowerCase();
          if (contenders.includes(name) && r.position >= 6) { extras.contenderBack = byNum.get(r.driver_number)?.full_name || name; extras.contenderBackPos = r.position; }
        }
      }
      const pred = predictGame(g, { extras, favorites });
      if (!pred) continue;
      out.push({ key: g.key, league: 'f1', id: g.id, eventId: g.eventId, start: g.start, day: ptDateKey(new Date(g.start)), gpName: g.gpName, circuit: g.circuit, session: g.session, broadcasts: g.broadcasts.map((b) => b.name), pred: compactPred(pred), inputs: { extras } });
    }
  }
  return out;
}

// ---------- team leagues ----------

function compactPred(p) {
  return {
    value: p.value, exact: p.exact, low: p.low, high: p.high, pGreat: p.pGreat, pDull: p.pDull,
    horizon: p.horizon, source: p.source, explain: p.explain, reasons: p.reasons,
    terms: p.terms.filter((t) => Math.abs(t.points) >= 0.5).map((t) => ({ key: t.key, text: t.text, points: t.points })),
    priority: p.priority, priorityParts: p.priorityParts, circle: p.circle, model: p.model, probs: p.probs,
  };
}

const favIds = (league) => FAVORITES.filter((f) => f.leagues.includes(league)).map((f) => String(f.id));

async function leaguePredictions(league, today) {
  const cfg = SEASONS[league];
  const pool = CFG.elo[league]?.pool;
  const hist = await leagueHistory(league, { refreshRecentHours: 2 });
  const poolHist = pool ? [...hist, ...(await leagueHistory(league === 'ucl' ? 'uel' : 'ucl', { refreshRecentHours: 2 }))] : hist;
  const book = walk(league, poolHist);
  await mkdir(`${OUT}/elo`, { recursive: true });
  await writeFile(`${OUT}/elo/${league}.json`, JSON.stringify(book.toJSON()));
  const current = hist[hist.length - 1];
  const season = current?.games || [];
  const until = addDays(today, CIRCLE_DAYS);
  const upcoming = season.filter((g) => g.st === 'pre' && !g.x && g.day >= today && g.day <= until);
  if (!upcoming.length) return { games: [], circle: [] };

  // Percentiles, style, structure.
  const ids = [...new Set(season.flatMap((g) => [g.h.id, g.a.id]))];
  const sorted = ids.map((id) => [id, book.rating(id)]).sort((a, b) => a[1] - b[1]);
  const pct = new Map(sorted.map(([id], i) => [id, (i + 1) / sorted.length]));
  const structure = await leagueStructure(league);
  const style = scoringStyle(season);

  // Season simulation -> importance for every remaining regular-season game.
  let importance = new Map();
  let impPct = new Map();
  if (FORMATS[league]) {
    const reg = season.filter((g) => !isPlayoff(toGame(g)) && !(pool && !/league/i.test(g.slug)) && countsInStandings(g, league));
    const remaining = reg.filter((g) => !g.done && !g.x).map((g) => ({ id: g.id, h: g.h.id, a: g.a.id, neutral: g.neutral }));
    if (remaining.length) {
      const targets = new Set(remaining.filter((g) => upcoming.some((u) => u.id === g.id)).map((g) => g.id));
      const res = simulateSeason({ league, table: standingsFrom(season.filter((g) => g.done), league), remaining, rating: (id) => book.rating(id), structure, targets, runs: RUNS, rng: seededRng(`${league}|${today}`) });
      importance = res.importance;
      const swings = [...importance.values()].map((v) => v.swing).sort((a, b) => a - b);
      for (const [id, v] of importance) impPct.set(id, swings.length ? swings.filter((s) => s <= v.swing).length / swings.length : 0);
    }
  }

  const goalies = league === 'nhl' ? await usualGoalies(today).catch(() => null) : null;

  // College: AP ranks like the app, and only the games the app shows.
  let ap = null;
  if (LEAGUE_BY_KEY[league].college) ap = await ADAPTERS[league].apRanks().catch(() => null);
  const games = [];
  const circle = [];
  // Injury/availability checks for the next 2 days; NFL also reads the week's wind forecast.
  const soon = upcoming.filter((g) => g.day <= addDays(today, league === 'nfl' ? 7 : 1));
  const avail = new Map();
  await mapLimit(soon, 4, async (g) => {
    const x = await availability(league, toGame(g)).catch(() => null);
    if (x) avail.set(g.id, x);
  });
  for (const g of upcoming) {
    const game = toGame(g);
    if (ap) { game.home.rank = ap.get(g.h.id) || null; game.away.rank = ap.get(g.a.id) || null; }
    const cg = { ...g, h: { ...g.h, r: game.home.rank }, a: { ...g.a, r: game.away.rank } };
    if (!displayable(league, cg)) continue;
    const imp = importance.get(g.id) || null;
    const inputs = {
      elo: { home: r1(book.rating(g.h.id)), away: r1(book.rating(g.a.id)) },
      eloPct: { home: r1(pct.get(g.h.id) ?? 0.5), away: r1(pct.get(g.a.id) ?? 0.5) },
      leagueSize: ids.length,
      importance: imp ? { swing: r1(imp.swing), home: r1(imp.home), away: r1(imp.away), dead: imp.dead, top: imp.top ? { side: imp.top.side, label: imp.top.label, swing: Math.round(imp.top.swing * 1000) / 1000 } : null } : null,
      importancePct: impPct.has(g.id) ? Math.round(impPct.get(g.id) * 100) / 100 : null,
      structure: { home: structure.get(g.h.id) || null, away: structure.get(g.a.id) || null },
      style: style ? { home: r1(style.get(g.h.id) ?? 0), away: r1(style.get(g.a.id) ?? 0) } : null,
      extras: avail.get(g.id) || null,
      goalieNo1: goalies ? { home: goalies.get(g.h.id) || null, away: goalies.get(g.a.id) || null } : null,
    };
    const pred = predictGame(game, { ...inputs, favorites: FAVORITES });
    if (!pred) continue;
    const entry = {
      key: `${league}:${g.id}`, league, id: g.id, start: g.start, day: g.day,
      home: { id: g.h.id, abbr: g.h.a, short: g.h.n, logo: g.h.l || '', color: g.h.col || null, rank: game.home.rank || null },
      away: { id: g.a.id, abbr: g.a.a, short: g.a.n, logo: g.a.l || '', color: g.a.col || null, rank: game.away.rank || null },
      notes: g.notes, neutral: g.neutral, broadcasts: g.tv || [],
      pred: compactPred(pred), inputs,
    };
    if (pred.horizon.key === 'circle') {
      if (pred.circle.flagged) circle.push({ key: entry.key, league, start: g.start, day: g.day, home: entry.home, away: entry.away, reasons: pred.circle.reasons });
    } else games.push(entry);
  }
  return { games, circle };
}

async function main() {
  const now = new Date();
  if (!FORCE) {
    const gate = await shouldRun(now);
    if (!gate.run) { console.log(`Skipping: ${gate.why}`); setOutput('generated', 'false'); return; }
  }
  const today = todayKey(now);
  let prev = null;
  try { prev = JSON.parse(await readFile(`${OUT}/predictions.json`, 'utf8')); } catch { /* none */ }
  const flaggedBefore = new Map((prev?.circle || []).concat((prev?.games || []).filter((g) => g.pred?.circle?.flagged)).map((c) => [c.key, c.flaggedAt || prev?.date]));
  const leagues = (ONLY || [...Object.keys(SEASONS), 'f1']);
  const games = [];
  const circle = [];
  const errors = [];
  for (const league of leagues) {
    const t0 = Date.now();
    try {
      if (league === 'f1') {
        games.push(...await f1Predictions(today, FAVORITES));
      } else {
        const r = await leaguePredictions(league, today);
        games.push(...r.games);
        circle.push(...r.circle);
      }
      console.log(`${league.padEnd(5)} ok (${Math.round((Date.now() - t0) / 1000)}s)`);
    } catch (e) {
      errors.push(`${league}: ${e.message}`);
      console.log(`${league.padEnd(5)} ERROR ${e.stack || e.message}`);
    }
  }
  // A partial run (--leagues) keeps the other leagues from the previous file.
  if (ONLY && prev) {
    games.push(...(prev.games || []).filter((g) => !ONLY.includes(g.league) && g.day >= today));
    circle.push(...(prev.circle || []).filter((c) => !ONLY.includes(c.league) && c.day >= today));
  }
  for (const g of games) if (g.pred?.circle?.flagged) g.flaggedAt = flaggedBefore.get(g.key) || today;
  for (const c of circle) c.flaggedAt = flaggedBefore.get(c.key) || today;
  games.sort((a, b) => (a.start < b.start ? -1 : 1));
  circle.sort((a, b) => (a.start < b.start ? -1 : 1));
  const out = {
    schema_version: 1,
    generated_at: now.toISOString(),
    date: today,
    scheduled: !FORCE,
    horizon_days: HORIZON_DAYS,
    model_version: PREDICTION_VERSION,
    games,
    circle,
    errors,
  };
  await writeFile(`${OUT}/predictions.json`, `${JSON.stringify(out)}\n`);
  console.log(`predictions.json: ${games.length} games in ${HORIZON_DAYS} days, ${circle.length} circled further out, ${errors.length} errors.`);
  setOutput('generated', 'true');
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(e); process.exitCode = 1; });
void parseOdds;
