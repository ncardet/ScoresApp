#!/usr/bin/env node
// Build the labeled sanity fixtures from test/fixtures/labeled_games.csv:
// find each game on ESPN (OpenF1 for F1), verify the score, and save a compact gzipped copy
// with the point-in-time pre-game inputs (Elo as of that date, closing line) to
// test/fixtures/labeled/<slug>.json.gz. Games that can't be confirmed are dropped and listed
// in test/fixtures/labeled/_dropped.json.
//
//   NODE_USE_ENV_PROXY=1 node scripts/labeled-fixtures.mjs [slug ...]

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { ADAPTERS } from '../site/js/adapters/index.js';
import { getJson } from '../site/js/adapters/espn/client.js';
import { parseEvent } from '../site/js/adapters/espn/parse.js';
import { parseStandings } from '../site/js/adapters/espn/standings.js';
import { lapTable, raceControlSummary } from '../site/js/adapters/f1.js';
import { addDays, espnDate } from '../site/js/core/time.js';
import { LEAGUE_BY_KEY } from '../site/js/core/leagues.js';
import { trimSummary } from './make-fixtures.mjs';
import { leagueHistory } from './lib/history.mjs';
import { walk } from './lib/elo-walk.mjs';
import CFG from '../site/config/prediction.json' with { type: 'json' };

const OUT = 'test/fixtures/labeled';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function parseCsv(text) {
  const [head, ...lines] = text.trim().split('\n');
  const cols = head.split(',');
  return lines.filter(Boolean).map((line) => {
    const cells = line.split(',');
    const row = Object.fromEntries(cols.map((c, i) => [c, cells[i] ?? '']));
    if (cells.length > cols.length) row.note = cells.slice(cols.length - 1).join(',');
    return row;
  });
}

const SB_PARAMS = { cfb: '&groups=80&limit=300', mcbb: '&groups=50&limit=500', wcbb: '&groups=50&limit=500' };
const has = (team, kw) => [team.name, team.short, team.location, team.abbr].filter(Boolean).some((n) => n.toLowerCase().includes(kw.toLowerCase()));

async function findEvent(row) {
  const lg = LEAGUE_BY_KEY[row.league];
  for (const d of [row.date, addDays(row.date, -1), addDays(row.date, 1)]) {
    const url = `https://site.api.espn.com/apis/site/v2/sports/${lg.espn}/scoreboard?dates=${espnDate(d)}${SB_PARAMS[row.league] || ''}`;
    const res = await getJson(url, { retries: 2 }).catch(() => null);
    for (const ev of res?.json?.events || []) {
      if (row.espn_id && String(ev.id) !== row.espn_id) continue;
      const g = parseEvent(ev, row.league);
      const t1 = has(g.home, row.team1) ? g.home : has(g.away, row.team1) ? g.away : null;
      const t2 = has(g.home, row.team2) ? g.home : has(g.away, row.team2) ? g.away : null;
      if (!t1 || !t2 || t1 === t2) continue;
      return { ev, g, t1, t2 };
    }
  }
  return null;
}

let books = {};
async function bookFor(league) {
  if (!books[league]) {
    const pool = CFG.elo[league]?.pool;
    const h = await leagueHistory(league);
    const all = pool ? [...h, ...(await leagueHistory(league === 'ucl' ? 'uel' : 'ucl'))] : h;
    const book = walk(league, all);
    const seasonTeams = new Map(h.map((x) => [x.season, x.games]));
    books[league] = { book, seasonTeams };
  }
  return books[league];
}

async function pregameInputs(row, g, summary) {
  const { book, seasonTeams } = await bookFor(row.league);
  const D = g.start ? new Date(g.start).toISOString().slice(0, 10) : row.date;
  // Percentile among teams active that season (season containing the date).
  let ids = [];
  for (const games of seasonTeams.values()) {
    if (games.length && games[0].day <= D && games[games.length - 1].day >= D) { ids = [...new Set(games.flatMap((x) => [x.h.id, x.a.id]))]; break; }
  }
  const vals = ids.map((id) => book.asOf(id, D)).sort((a, b) => a - b);
  const pctOf = (r) => (vals.length ? vals.filter((v) => v <= r).length / vals.length : 0.5);
  const eh = book.asOf(g.home.id, D);
  const ea = book.asOf(g.away.id, D);
  const pc = (summary.pickcenter || [])[0];
  return { elo: { home: eh, away: ea }, eloPct: { home: pctOf(eh), away: pctOf(ea) }, leagueSize: ids.length || 30, hasLine: !!pc };
}

async function openf1(path) {
  for (let attempt = 0; attempt < 5; attempt++) {
    await sleep(2200);
    try { return (await getJson(`https://api.openf1.org/v1/${path}`, { retries: 0, timeout: 30000 })).json; } catch (e) {
      if (e.status !== 429 || attempt === 4) throw e;
      await sleep(15000 * (attempt + 1));
    }
  }
  return null;
}

async function buildF1(row) {
  const year = +row.date.slice(0, 4);
  if (year < 2023) return { drop: 'OpenF1 has no lap data before 2023' };
  const sessions = await openf1(`sessions?year=${year}`);
  const race = sessions.find((s) => s.session_name === 'Race' && s.date_start.slice(0, 10) === row.date && `${s.location} ${s.circuit_short_name} ${s.country_name}`.toLowerCase().includes(row.team1.toLowerCase().slice(0, 5)));
  if (!race) return { drop: 'race not found in OpenF1' };
  const races = sessions.filter((s) => s.session_name === 'Race').sort((a, b) => new Date(a.date_start) - new Date(b.date_start));
  const raceIndex = races.indexOf(race);
  const laps = lapTable(await openf1(`laps?session_key=${race.session_key}`));
  const overtakes = await openf1(`overtakes?session_key=${race.session_key}`).catch(() => null);
  const rc = raceControlSummary(await openf1(`race_control?session_key=${race.session_key}`));
  const result = await openf1(`session_result?session_key=${race.session_key}`).catch(() => []);
  const q = sessions.find((s) => s.meeting_key === race.meeting_key && s.session_name === 'Qualifying');
  const quali = q ? await openf1(`session_result?session_key=${q.session_key}`).catch(() => null) : null;
  const st = await getJson(`https://site.api.espn.com/apis/v2/sports/racing/f1/standings?season=${year}`).catch(() => null);
  const best = (r) => (Array.isArray(r.duration) ? r.duration.filter(Number.isFinite).at(-1) : r.duration);
  const qs = (quali || []).filter((r) => r.position).sort((a, b) => a.position - b.position);
  return {
    f1: {
      race: { location: race.location, circuit: race.circuit_short_name, start: race.date_start, raceIndex },
      laps, overtakes: Array.isArray(overtakes) ? overtakes.length : null, control: rc,
      classification: (result || []).sort((a, b) => (a.position ?? 99) - (b.position ?? 99)).map((r) => ({ position: r.position, number: r.driver_number, gap: r.gap_to_leader })),
      standings: st ? parseStandings(st.json) : null,
      raceIndex,
      qualiGap: qs.length > 1 && best(qs[0]) && best(qs[1]) ? best(qs[1]) - best(qs[0]) : null,
    },
  };
}

async function main() {
  const only = new Set(process.argv.slice(2));
  const rows = parseCsv(await readFile('test/fixtures/labeled_games.csv', 'utf8'));
  await mkdir(OUT, { recursive: true });
  const dropped = [];
  for (const row of rows) {
    if (only.size && !only.has(row.slug)) continue;
    try {
      let payload;
      if (row.league === 'f1') {
        const f = await buildF1(row);
        if (f.drop) { dropped.push({ slug: row.slug, reason: f.drop }); console.log(`${row.slug}: DROPPED (${f.drop})`); continue; }
        payload = { ...row, ...f };
      } else {
        const hit = await findEvent(row);
        if (!hit) { dropped.push({ slug: row.slug, reason: 'not found on ESPN scoreboard' }); console.log(`${row.slug}: DROPPED (not found)`); continue; }
        const { ev, g, t1, t2 } = hit;
        if (String(t1.score) !== row.score1 || String(t2.score) !== row.score2) {
          dropped.push({ slug: row.slug, reason: `score mismatch: ESPN has ${t1.short} ${t1.score}-${t2.score} ${t2.short}` });
          console.log(`${row.slug}: DROPPED (score ${t1.score}-${t2.score})`);
          continue;
        }
        const s = await getJson(ADAPTERS[row.league].urls.summary(ev.id));
        const summary = trimSummary(s.json);
        payload = { ...row, espn_id: String(ev.id), event: ev, summary, pregame: await pregameInputs(row, g, s.json) };
      }
      await writeFile(`${OUT}/${row.slug}.json.gz`, gzipSync(JSON.stringify(payload)));
      console.log(`${row.slug}: ok`);
    } catch (e) {
      dropped.push({ slug: row.slug, reason: `error: ${e.message}` });
      console.log(`${row.slug}: ERROR ${e.message}`);
    }
  }
  if (!only.size) await writeFile(`${OUT}/_dropped.json`, `${JSON.stringify(dropped, null, 2)}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
