#!/usr/bin/env node
// Backfill: score a sample of recent finished games per league and write the calibration files
// the app uses to turn raw scores into 0-100 ratings by percentile (site/data/calibration/*.json).
//
// Usage:
//   node scripts/backfill.mjs                       # all leagues, ~220 games each, last 365 days
//                                                   (2 seasons for UCL/UEL/WSL/NWSL)
//   node scripts/backfill.mjs --leagues nba,nhl --games 300 --days 400
//   node scripts/backfill.mjs --leagues f1 --years 2024,2025,2026
// Behind an HTTPS proxy add NODE_USE_ENV_PROXY=1 (Node >= 22.21).
//
// Files store RAW component values per game, so changing weights in config/rating.js does not
// require re-running this. Re-run once a season (or when the engine's maths changes).

import { writeFile, mkdir } from 'node:fs/promises';
import { ADAPTERS } from '../site/js/adapters/index.js';
import { LEAGUES } from '../site/js/core/leagues.js';
import { addDays, todayKey } from '../site/js/core/time.js';
import { measure, ENGINE_VERSION } from '../site/js/rating/index.js';
import { COMPONENTS, F1_COMPONENTS } from '../site/js/rating/calibrate.js';
import { measureF1, f1PriorRaw } from '../site/js/rating/f1.js';
import { getJson, mapLimit } from '../site/js/adapters/espn/client.js';
import { lapTable, raceControlSummary } from '../site/js/adapters/f1.js';
import { parseStandings } from '../site/js/adapters/espn/standings.js';
import FAVORITES from '../site/config/favorites.js';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, arr) => {
  if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true]);
  return acc;
}, []));
const LEAGUE_KEYS = args.leagues ? String(args.leagues).split(',') : LEAGUES.map((l) => l.key);
const TARGET = +args.games || 220;
const CONC = +args.concurrency || 6;
const OUT = args.out || 'site/data/calibration';
// Weekly sports need every date to find enough games; small competitions need two seasons.
const LEAGUE_DEFAULTS = {
  nfl: { scoreboards: 365 },
  cfb: { scoreboards: 365 },
  ucl: { days: 730, scoreboards: 500 },
  uel: { days: 730, scoreboards: 500 },
  wsl: { days: 730, scoreboards: 500 },
  nwsl: { days: 730, scoreboards: 500 },
};
const daysFor = (key) => +args.days || LEAGUE_DEFAULTS[key]?.days || 365;
const scoreboardsFor = (key) => +args.scoreboards || LEAGUE_DEFAULTS[key]?.scoreboards || 160;

// Deterministic shuffle so re-runs sample the same games.
function shuffle(arr, seed = 42) {
  const a = [...arr];
  let s = seed;
  const rand = () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const r4 = (x) => (Number.isFinite(x) ? Math.round(x * 10000) / 10000 : 0);

async function collectGames(key) {
  const a = ADAPTERS[key];
  const today = todayKey();
  const DAYS = daysFor(key);
  const MAX_SCOREBOARDS = scoreboardsFor(key);
  const dates = shuffle(Array.from({ length: DAYS }, (_, i) => addDays(today, -(i + 1))), key.length * 7919);
  const favIds = FAVORITES.filter((f) => f.leagues.includes(key)).map((f) => f.id);
  const games = new Map();
  let used = 0;
  for (let i = 0; i < dates.length && used < MAX_SCOREBOARDS && games.size < TARGET * 1.6; i += CONC) {
    const batch = dates.slice(i, i + CONC);
    used += batch.length;
    const res = await mapLimit(batch, CONC, (d) => a.scoreboard(d, { favoriteTeamIds: favIds }));
    for (const r of res) {
      for (const g of r?.games || []) {
        if (g.state === 'post' && g.completed && !g.canceled && g.home && g.away) games.set(g.key, g);
      }
    }
  }
  return { games: shuffle([...games.values()], 7).slice(0, TARGET), scoreboards: used };
}

async function backfillLeague(key) {
  const a = ADAPTERS[key];
  const t0 = Date.now();
  const { games, scoreboards } = await collectGames(key);
  let espn = 0;
  let model = 0;
  const rows = [];
  const prior = [];
  const failures = [];
  await mapLimit(games, CONC, async (g) => {
    try {
      const detail = await a.summary(g);
      if (!detail.plays?.length && !detail.soccer?.goals) throw new Error('no plays');
      const m = measure(detail);
      rows.push(COMPONENTS.map((c) => r4(m.raw[c])));
      prior.push(r4(m.priorRaw));
      if (m.timeline.source === 'espn') espn++; else model++;
    } catch (e) {
      failures.push(`${g.key}: ${e.message}`);
    }
  });
  const file = {
    league: key,
    engine: ENGINE_VERSION,
    generated: new Date().toISOString(),
    window: `last ${daysFor(key)} days to ${todayKey()}`,
    n: rows.length,
    sources: { espnWinProbability: espn, fallbackModel: model },
    columns: COMPONENTS,
    rows,
    prior,
  };
  await writeFile(`${OUT}/${key}.json`, JSON.stringify(file));
  console.log(`${key.padEnd(5)} ${rows.length} games (${scoreboards} scoreboards, wp espn ${espn}/model ${model}, ${failures.length} failed) in ${Math.round((Date.now() - t0) / 1000)}s`);
  if (failures.length) console.log(`      e.g. ${failures.slice(0, 3).join(' | ')}`);
}

// ---------- F1 (OpenF1 + ESPN standings) ----------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// OpenF1's free tier allows roughly 30 requests a minute: pace calls and back off on HTTP 429.
async function openf1(path) {
  for (let attempt = 0; attempt < 5; attempt++) {
    await sleep(2200);
    try {
      return (await getJson(`https://api.openf1.org/v1/${path}`, { retries: 0, timeout: 30000 })).json;
    } catch (e) {
      if (e.status !== 429 || attempt === 4) throw e;
      await sleep(15000 * (attempt + 1));
    }
  }
  return null;
}

async function backfillF1() {
  const years = String(args.years || '2024,2025,2026').split(',').map(Number);
  const rows = [];
  const prior = [];
  for (const year of years) {
    const sessions = (await openf1(`sessions?year=${year}&session_name=Race`))
      .filter((s) => new Date(s.date_end) < new Date())
      .sort((x, y) => new Date(x.date_start) - new Date(y.date_start));
    const st = await getJson(`https://site.api.espn.com/apis/v2/sports/racing/f1/standings?season=${year}`).catch(() => null);
    const standings = st ? parseStandings(st.json) : null;
    for (const [raceIndex, s] of sessions.entries()) {
      try {
        const laps = await openf1(`laps?session_key=${s.session_key}`);
        const overtakes = await openf1(`overtakes?session_key=${s.session_key}`).catch(() => null);
        const rc = await openf1(`race_control?session_key=${s.session_key}`);
        const result = await openf1(`session_result?session_key=${s.session_key}`).catch(() => []);
        const table = lapTable(laps);
        if (table.length < 5) throw new Error('no laps');
        const classification = (result || []).sort((x, y) => (x.position ?? 99) - (y.position ?? 99)).map((r) => ({ position: r.position, gap: r.gap_to_leader }));
        const detail = { f1: { laps: table, overtakes: Array.isArray(overtakes) ? overtakes.length : null, control: raceControlSummary(rc), classification, standings, raceIndex } };
        const m = measureF1(detail);
        rows.push(F1_COMPONENTS.map((c) => r4(m.raw[c])));
        prior.push(r4(f1PriorRaw({ circuit: s.circuit_short_name, gpName: s.location, isRace: true }, standings, raceIndex).raw));
        console.log(`  f1 ${year} R${raceIndex + 1} ${s.location}: lead changes ${m.raw.leadChanges}, overtakes ${m.raw.overtakes}, gap ${m.raw.finalGap.toFixed(2)}, incidents ${m.raw.incidents.toFixed(2)}, stakes ${m.raw.stakes.toFixed(2)}`);
      } catch (e) {
        console.log(`  f1 ${year} ${s.location}: skipped (${e.message})`);
      }
    }
  }
  const file = {
    league: 'f1', engine: ENGINE_VERSION, generated: new Date().toISOString(), window: `races ${years.join(', ')}`,
    n: rows.length, columns: F1_COMPONENTS, rows, prior,
  };
  await writeFile(`${OUT}/f1.json`, JSON.stringify(file));
  console.log(`f1    ${rows.length} races`);
}

async function main() {
  await mkdir(OUT, { recursive: true });
  for (const key of LEAGUE_KEYS) {
    try {
      if (key === 'f1') await backfillF1();
      else await backfillLeague(key);
    } catch (e) {
      console.error(`${key}: backfill failed: ${e.stack || e.message}`);
      process.exitCode = 1;
    }
  }
}

main();
