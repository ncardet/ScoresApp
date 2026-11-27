// Formula 1 adapter.
//   ESPN  -> weekend schedule, one Game per session, finishing order, driver/constructor standings.
//   OpenF1 (free, CORS-open) -> race laps, overtakes, race-control flags, for the race rating.
// ESPN has no racing summary endpoint (HTTP 404), so the game page is built from these two.

import { getJson } from './espn/client.js';
import { parseF1Event } from './espn/parse.js';
import { parseStandings } from './espn/standings.js';
import { SITE, SITE_V2 } from './espn/league.js';
import { espnDate, ptDateKey, addDays } from '../core/time.js';
import { LEAGUE_BY_KEY } from '../core/leagues.js';

const OPENF1 = 'https://api.openf1.org/v1';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// OpenF1's free tier rejects bursts, so calls are serialized and spaced.
let chain = Promise.resolve();
function openf1(path) {
  const run = chain.then(async () => {
    const res = await getJson(`${OPENF1}/${path}`, { timeout: 15000, retries: 2, persist: true });
    await sleep(350);
    return res.json;
  });
  chain = run.catch(() => {});
  return run;
}

/** Find the OpenF1 race session for an ESPN race start time (same day +-1). */
async function findRaceSession(startIso) {
  const year = new Date(startIso).getUTCFullYear();
  const sessions = await openf1(`sessions?year=${year}&session_name=Race`);
  const t = new Date(startIso).getTime();
  const sorted = [...(sessions || [])].sort((a, b) => new Date(a.date_start) - new Date(b.date_start));
  let best = null;
  for (const s of sorted) {
    const d = Math.abs(new Date(s.date_start).getTime() - t);
    if (d < 36 * 3600 * 1000 && (!best || d < best.d)) best = { s, d };
  }
  // raceIndex = 0-based round among the season's races (lines up with ESPN standings columns).
  return best ? { ...best.s, raceIndex: sorted.indexOf(best.s) } : null;
}

/**
 * Build per-lap order and P1-P2 gaps from lap timing: a driver completes lap L at
 * date_start(L) + lap_duration(L). Sorting completion times per lap gives the order.
 */
export function lapTable(laps) {
  const byLap = new Map();
  for (const l of laps || []) {
    if (!l.date_start || !l.lap_duration) continue;
    const done = new Date(l.date_start).getTime() / 1000 + l.lap_duration;
    if (!byLap.has(l.lap_number)) byLap.set(l.lap_number, []);
    byLap.get(l.lap_number).push({ driver: l.driver_number, done, pit: !!l.is_pit_out_lap });
  }
  const table = [];
  for (const lap of [...byLap.keys()].sort((a, b) => a - b)) {
    const rows = byLap.get(lap).sort((a, b) => a.done - b.done);
    table.push({
      lap,
      order: rows.map((r) => r.driver),
      gap12: rows.length > 1 ? rows[1].done - rows[0].done : null,
      pits: rows.filter((r) => r.pit).map((r) => r.driver),
    });
  }
  return table;
}

/** The race-control messages the rating reads, compacted for caching ({lap, flag, msg}). */
export function compactRaceControl(rc) {
  return (rc || [])
    .filter((m) => m.flag || /SAFETY CAR|RED FLAG/i.test(m.message || ''))
    .map((m) => ({ lap_number: m.lap_number ?? null, flag: m.flag || null, message: m.message || '' }));
}

/** Summarize race-control messages into neutralisations. */
export function raceControlSummary(rc) {
  let safetyCars = 0;
  let vsc = 0;
  let redFlags = 0;
  const events = [];
  for (const m of rc || []) {
    const msg = (m.message || '').toUpperCase();
    if (/^SAFETY CAR DEPLOYED/.test(msg)) { safetyCars++; events.push({ lap: m.lap_number, type: 'SC' }); }
    else if (/^VIRTUAL SAFETY CAR DEPLOYED/.test(msg)) { vsc++; events.push({ lap: m.lap_number, type: 'VSC' }); }
    // "CHEQUERED FLAG" contains the letters "RED FLAG": match the word, never the finish.
    else if (m.flag === 'RED' || /(^|[^A-Z])RED FLAG/.test(msg)) { redFlags++; events.push({ lap: m.lap_number, type: 'Red flag' }); }
  }
  return { safetyCars, vsc, redFlags, events };
}

const f1League = LEAGUE_BY_KEY.f1;
const base = `${SITE}/${f1League.espn}`;

export default {
  key: 'f1',
  league: f1League,
  urls: {
    scoreboard: (dateKey) => `${base}/scoreboard?dates=${espnDate(dateKey)}`,
    standings: () => `${SITE_V2}/${f1League.espn}/standings`,
  },

  /** Sessions on a Pacific date. ESPN returns the whole weekend for any day inside it. */
  async scoreboard(dateKey, ctx = {}) {
    const days = [dateKey, addDays(dateKey, 1)];
    const results = await Promise.all(days.map((d) => getJson(this.urls.scoreboard(d), { persist: !!ctx.persist }).catch(() => null)));
    const seen = new Set();
    const games = [];
    let at = 0;
    let stale = false;
    for (const res of results) {
      if (!res) continue;
      at = Math.max(at, res.at);
      stale = stale || res.stale;
      for (const ev of res.json?.events || []) {
        for (const g of parseF1Event(ev)) {
          if (seen.has(g.key) || ptDateKey(new Date(g.start)) !== dateKey) continue;
          seen.add(g.key);
          games.push(g);
        }
      }
    }
    if (!results.some(Boolean)) throw new Error('F1 scoreboard unavailable');
    return { games, at: at || Date.now(), stale };
  },

  /** Race detail from OpenF1 (laps, overtakes, flags) + ESPN finishing order. */
  async summary(game, ctx = {}) {
    const detail = {
      key: game.key, league: 'f1', sport: 'racing', game,
      plays: [], wp: null, box: null, teamStats: null,
      f1: { results: game.drivers || [], laps: null, overtakes: null, control: null, standings: null },
      fetchedAt: Date.now(), stale: false,
    };
    if (!game.isRace || game.state === 'pre') return detail;
    const session = await findRaceSession(game.start).catch(() => null);
    if (!session) return detail;
    detail.f1.sessionKey = session.session_key;
    detail.f1.raceIndex = session.raceIndex;
    const sk = session.session_key;
    const drivers = await openf1(`drivers?session_key=${sk}`).catch(() => []);
    const names = new Map((drivers || []).map((d) => [d.driver_number, {
      number: d.driver_number, name: d.full_name, acronym: d.name_acronym, team: d.team_name, color: d.team_colour,
    }]));
    const [laps, overtakes, rc, result] = [
      await openf1(`laps?session_key=${sk}`).catch(() => null),
      await openf1(`overtakes?session_key=${sk}`).catch(() => null),
      await openf1(`race_control?session_key=${sk}`).catch(() => null),
      await openf1(`session_result?session_key=${sk}`).catch(() => null),
    ];
    const table = laps ? lapTable(laps) : null;
    detail.f1.drivers = Object.fromEntries(names);
    detail.f1.laps = table;
    detail.f1.totalLaps = table?.length || null;
    detail.f1.overtakes = Array.isArray(overtakes) ? overtakes.length : null;
    detail.f1.control = rc ? raceControlSummary(rc) : null;
    if (Array.isArray(result) && result.length) {
      detail.f1.classification = result
        .sort((a, b) => (a.position ?? 99) - (b.position ?? 99))
        .map((r) => ({
          position: r.position, number: r.driver_number, ...names.get(r.driver_number),
          laps: r.number_of_laps, gap: r.gap_to_leader, points: r.points, dnf: r.dnf, dns: r.dns, dsq: r.dsq,
        }));
    }
    if (ctx.standings !== false) {
      detail.f1.standings = await this.standings().catch(() => null);
    }
    return detail;
  },

  async standings() {
    const res = await getJson(this.urls.standings(), { persist: true });
    return { ...parseStandings(res.json), at: res.at, stale: res.stale };
  },
};
