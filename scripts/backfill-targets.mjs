#!/usr/bin/env node
// Backfill training targets for the pre-game model: for every displayable game in the evaluation
// seasons (scripts/lib/history.mjs SEASONS[...].eval), fetch the ESPN summary, measure the
// ACTUAL post-game components with the rating engine, and keep the pre-kickoff closing line
// (summary pickcenter). Cached per league-season in .cache/targets, so runs are resumable.
//
//   node scripts/backfill-targets.mjs [--leagues nba,nfl] [--concurrency 6]
// Behind a proxy: NODE_USE_ENV_PROXY=1.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ADAPTERS } from '../site/js/adapters/index.js';
import { mapLimit, getJson } from '../site/js/adapters/espn/client.js';
import { LEAGUE_BY_KEY, LEAGUES } from '../site/js/core/leagues.js';
import { measure } from '../site/js/rating/index.js';
import { leagueHistory, SEASONS, CACHE_DIR } from './lib/history.mjs';
import { measureF1 } from '../site/js/rating/f1.js';
import { lapTable, raceControlSummary, compactRaceControl } from '../site/js/adapters/f1.js';
import { F1_COMPONENTS } from '../site/js/rating/calibrate.js';
import { parseStandings } from '../site/js/adapters/espn/standings.js';
import FAVORITES from '../site/config/favorites.js';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, arr) => {
  if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true]);
  return acc;
}, []));
const LEAGUE_KEYS = args.leagues ? String(args.leagues).split(',') : [...Object.keys(SEASONS), 'f1'];
const CONC = +args.concurrency || 6;
export const TARGET_DIR = join(CACHE_DIR, '..', 'targets');
export const TARGET_VERSION = 2; // 2: ESPN reversed home/away play scores are detected and fixed
const r4 = (x) => (Number.isFinite(x) ? Math.round(x * 10000) / 10000 : 0);

const favIds = (league) => new Set(FAVORITES.filter((f) => f.leagues.includes(league)).map((f) => String(f.id)));

/** Games the app would show (college: AP Top 25, favorites, NCAA tournament). */
export function displayable(league, g) {
  if (!LEAGUE_BY_KEY[league].college) return true;
  const fav = favIds(league);
  return !!(g.h.r || g.a.r || g.tour || fav.has(g.h.id) || fav.has(g.a.id));
}

/** Compact history game -> minimal adapter Game, enough for summary parsing. */
export function toGame(g) {
  const lg = LEAGUE_BY_KEY[g.league];
  const team = (t) => ({ id: t.id, abbr: t.a, short: t.n, name: t.n, score: t.s, winner: t.w, rank: t.r, record: t.rec || '', linescores: [], logo: t.l || '', color: t.col || null });
  return {
    key: `${g.league}:${g.id}`, id: g.id, league: g.league, sport: lg.sport, start: g.start,
    state: g.st, completed: g.done, canceled: g.x, detail: g.detail, period: g.period,
    home: team(g.h), away: team(g.a), notes: g.notes || [], seasonType: g.stype, seasonSlug: g.slug,
    neutral: g.neutral, conferenceGame: g.conf, tournament: g.tour, broadcasts: (g.tv || []).map((name) => ({ name, market: 'national' })),
    odds: g.odds ? { home: g.odds.h, away: g.odds.a, draw: g.odds.d, spread: g.odds.sp, overUnder: g.odds.ou } : null,
    series: g.series ? (g.series.k === 'aggregate'
      ? { kind: 'aggregate', homeAgg: g.series.ha, awayAgg: g.series.aa, summary: g.series.sum }
      : { homeWins: g.series.hw, awayWins: g.series.aw, total: g.series.n, toWin: g.series.n ? Math.floor(g.series.n / 2) + 1 : null, summary: g.series.sum }) : null,
    soccer: lg.sport === 'soccer' ? { events: [] } : null,
  };
}

async function loadCache(file) {
  try { return JSON.parse(await readFile(file, 'utf8')); } catch { return {}; }
}

async function backfillLeague(league) {
  const hist = await leagueHistory(league);
  const a = ADAPTERS[league];
  for (const season of SEASONS[league].eval) {
    const file = join(TARGET_DIR, league, `${season}.json`);
    await mkdir(join(TARGET_DIR, league), { recursive: true });
    const cache = await loadCache(file);
    const games = (hist.find((h) => h.season === season)?.games || []).filter((g) => g.done && !g.x && displayable(league, g));
    // Refetch entries from before the base-measurement format (raw only), and neutral-site games
    // or big "comebacks" measured before the reversed-sides fix (TARGET_VERSION 2).
    const stale = (c) => (c.v || 1) < TARGET_VERSION && (c.b?.cb > 0.3 || c.neutral);
    const todo = games.filter((g) => {
      const c = cache[g.id];
      if (!c) return true;
      if (c.error) return false;
      return !c.b?.swb || stale({ ...c, neutral: g.neutral });
    });
    const t0 = Date.now();
    let n = 0;
    let saveAt = Date.now();
    await mapLimit(todo, CONC, async (g) => {
      try {
        const detail = await a.summary(toGame(g), { advanced: false });
        if (!detail.plays?.length && !detail.soccer?.goals?.length) throw new Error('no plays');
        const m = measure(detail);
        const o = detail.odds;
        cache[g.id] = {
          b: Object.fromEntries(Object.entries(m.base).map(([k, v]) => [k, Array.isArray(v) ? v : r4(v)])),
          src: m.timeline.source === 'espn' ? 1 : 0,
          line: o && (o.home != null || o.spread != null) ? { h: o.home, a: o.away, d: o.draw, sp: o.spread, ou: o.overUnder, det: o.details || '' } : null,
          fb: detail.predictor?.home ?? null,
          v: TARGET_VERSION,
          ...(detail.sidesFixed ? { fx: 1 } : {}),
          ...(detail.wpDropped ? { wd: 1 } : {}),
        };
      } catch (e) {
        cache[g.id] = { error: String(e.message || e).slice(0, 80) };
      }
      n++;
      if (Date.now() - saveAt > 15000) { saveAt = Date.now(); await writeFile(file, JSON.stringify(cache)); }
    });
    await writeFile(file, JSON.stringify(cache));
    const ok = Object.values(cache).filter((v) => v.b).length;
    console.log(`${league.padEnd(5)} ${season}: ${games.length} games, fetched ${n} now, ${ok} usable, ${Math.round((Date.now() - t0) / 1000)}s`);
  }
}

// ---------- F1 (OpenF1 + ESPN standings), races 2023-2026 ----------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
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
  const file = join(TARGET_DIR, 'f1', 'races.json');
  await mkdir(join(TARGET_DIR, 'f1'), { recursive: true });
  const cache = await loadCache(file);
  for (const year of [2023, 2024, 2025, 2026]) {
    const sessions = await openf1(`sessions?year=${year}`);
    const races = sessions.filter((s) => s.session_name === 'Race' && new Date(s.date_end) < new Date()).sort((x, y) => new Date(x.date_start) - new Date(y.date_start));
    const st = await getJson(`https://site.api.espn.com/apis/v2/sports/racing/f1/standings?season=${year}`).catch(() => null);
    const standings = st ? parseStandings(st.json) : null;
    (cache._standings ||= {})[year] = standings;
    for (const [raceIndex, s] of races.entries()) {
      const key = String(s.session_key);
      // Version 2 keeps the compact inputs (lap table, race control, classification) so the
      // race can be re-measured after a rating change without refetching OpenF1.
      // Network failures are retried on the next run; a race without lap data is not.
      if (cache[key]?.v === 2 && (cache[key].raw || /no laps|HTTP 404/.test(cache[key].error || ''))) continue;
      try {
        const laps = await openf1(`laps?session_key=${s.session_key}`);
        const table = lapTable(laps);
        if (table.length < 5) throw new Error('no laps');
        const rc = await openf1(`race_control?session_key=${s.session_key}`);
        const result = await openf1(`session_result?session_key=${s.session_key}`).catch(() => []);
        // Qualifying of the same meeting (pre-race information).
        const q = sessions.find((x) => x.meeting_key === s.meeting_key && x.session_name === 'Qualifying');
        const quali = q ? await openf1(`session_result?session_key=${q.session_key}`).catch(() => null) : null;
        const classification = (result || []).sort((x, y) => (x.position ?? 99) - (y.position ?? 99)).map((r) => ({ position: r.position, gap: r.gap_to_leader, number: r.driver_number }));
        const m = measureF1({ f1: { laps: table, control: raceControlSummary(rc), classification, standings, raceIndex } });
        const best = (r) => (Array.isArray(r.duration) ? r.duration.filter(Number.isFinite).at(-1) : r.duration);
        const qs = (quali || []).filter((r) => r.position).sort((x, y) => x.position - y.position);
        const qGap = qs.length > 1 && best(qs[0]) && best(qs[1]) ? best(qs[1]) - best(qs[0]) : null;
        cache[key] = {
          v: 2, year, raceIndex, location: s.location, circuit: s.circuit_short_name, start: s.date_start,
          raw: F1_COMPONENTS.map((c) => r4(m.raw[c])),
          quali: qs.slice(0, 10).map((r) => r.driver_number), qGap: qGap != null ? r4(qGap) : null,
          input: { laps: table, rc: compactRaceControl(rc), classification },
        };
        console.log(`  f1 ${year} R${raceIndex + 1} ${s.location}: ok`);
      } catch (e) {
        cache[key] = { v: 2, year, raceIndex, location: s.location, error: String(e.message || e).slice(0, 80) };
        console.log(`  f1 ${year} ${s.location}: ${e.message}`);
      }
      await writeFile(file, JSON.stringify(cache));
    }
  }
  console.log(`f1    ${Object.values(cache).filter((v) => v.raw).length} races`);
}

async function main() {
  for (const league of LEAGUE_KEYS) {
    try {
      if (league === 'f1') await backfillF1();
      else await backfillLeague(league);
    } catch (e) {
      console.error(`${league}: ${e.stack || e.message}`);
      process.exitCode = 1;
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main();
void LEAGUES;
