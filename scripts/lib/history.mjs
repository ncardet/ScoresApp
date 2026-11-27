// Historical results per league, fetched from ESPN and cached on disk (.cache/history) so the
// backfill and the nightly job are resumable and light on ESPN. Each league uses the cheapest
// query style that works (date ranges are rejected by ESPN):
//   day   one scoreboard per game date (NBA, NHL, MLB, college basketball)
//   week  one scoreboard per week (NFL, college football)
//   year  one scoreboard per calendar year (soccer: a full season in 1-2 requests)

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { getJson, mapLimit } from '../../site/js/adapters/espn/client.js';
import { parseEvent } from '../../site/js/adapters/espn/parse.js';
import { LEAGUE_BY_KEY } from '../../site/js/core/leagues.js';
import { addDays, ptDateKey, todayKey, espnDate } from '../../site/js/core/time.js';

const SITE = 'https://site.api.espn.com/apis/site/v2/sports';
export const CACHE_DIR = process.env.SIDELINE_CACHE || '.cache/history';

const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

/**
 * Seasons walked per league. `seasons` includes Elo burn-in years; `eval` are scored in the backtest.
 * Season keys: NBA/NHL/college basketball use the ending year (2026 = 2025-26), like ESPN;
 * European soccer uses the starting year (2025 = 2025-26); NFL/CFB/MLB/MLS/NWSL the calendar year.
 */
export const SEASONS = {
  nfl: { kind: 'week', seasons: range(2021, 2026), eval: [2024, 2025] },
  cfb: { kind: 'week', seasons: range(2021, 2026), eval: [2023, 2024, 2025], params: '&groups=80&limit=300' },
  nba: { kind: 'day', seasons: range(2022, 2027), eval: [2025, 2026], window: (y) => [`${y - 1}-10-01`, `${y}-06-30`] },
  wnba: { kind: 'day', seasons: range(2024, 2027), eval: [2025, 2026], window: (y) => [`${y}-05-01`, `${y}-11-10`] },
  nhl: { kind: 'day', seasons: range(2023, 2027), eval: [2025, 2026], window: (y) => [`${y - 1}-10-01`, `${y}-06-30`] },
  mlb: { kind: 'day', seasons: range(2024, 2026), eval: [2025, 2026], window: (y) => [`${y}-03-15`, `${y}-11-10`], noCalendar: true },
  mcbb: { kind: 'day', seasons: range(2022, 2027), eval: [2024, 2025, 2026], window: (y) => [`${y - 1}-11-01`, `${y}-04-10`], params: '&groups=50&limit=500' },
  wcbb: { kind: 'day', seasons: range(2022, 2027), eval: [2024, 2025, 2026], window: (y) => [`${y - 1}-11-01`, `${y}-04-10`], params: '&groups=50&limit=500' },
  epl: { kind: 'year', seasons: range(2022, 2026), eval: [2023, 2024, 2025], window: (y) => [`${y}-07-15`, `${y + 1}-06-15`] },
  wsl: { kind: 'year', seasons: range(2022, 2026), eval: [2023, 2024, 2025], window: (y) => [`${y}-07-15`, `${y + 1}-06-15`] },
  ucl: { kind: 'year', seasons: range(2021, 2026), eval: [2023, 2024, 2025], window: (y) => [`${y}-08-15`, `${y + 1}-06-10`] },
  uel: { kind: 'year', seasons: range(2021, 2026), eval: [2023, 2024, 2025], window: (y) => [`${y}-08-15`, `${y + 1}-06-10`] },
  mls: { kind: 'year', seasons: range(2021, 2026), eval: [2024, 2025, 2026], window: (y) => [`${y}-02-01`, `${y}-12-20`] },
  nwsl: { kind: 'year', seasons: range(2022, 2026), eval: [2024, 2025, 2026], window: (y) => [`${y}-02-01`, `${y}-12-20`] },
};

const US_PRESEASON = new Set(['nfl', 'cfb', 'nba', 'wnba', 'nhl', 'mlb', 'mcbb', 'wcbb']);

/** Compact, JSON-friendly game record (what Elo, standings and the backtest need). */
export function compact(g, season) {
  const t = (x) => ({
    id: x.id, a: x.abbr, n: x.short || x.name, s: x.score, w: !!x.winner, r: x.rank || null, c: x.conferenceId || null, rec: x.record || '',
    l: x.logo || undefined, col: x.color || undefined,
  });
  return {
    id: g.id,
    league: g.league,
    season,
    start: g.start,
    day: ptDateKey(new Date(g.start)),
    st: g.state,
    done: !!g.completed && g.state === 'post',
    x: !!g.canceled,
    stype: g.seasonType,
    slug: g.seasonSlug || '',
    neutral: !!g.neutral,
    conf: !!g.conferenceGame,
    notes: (g.notes || []).slice(0, 2),
    tour: !!g.tournament,
    detail: g.detail || '',
    period: g.period || 0,
    h: t(g.home),
    a: t(g.away),
    odds: g.odds ? { h: g.odds.home, a: g.odds.away, d: g.odds.draw, sp: g.odds.spread, ou: g.odds.overUnder } : null,
    series: g.series ? { k: g.series.kind || 'series', hw: g.series.homeWins, aw: g.series.awayWins, n: g.series.total, ha: g.series.homeAgg ?? null, aa: g.series.awayAgg ?? null, sum: g.series.summary || '' } : null,
    tv: (g.broadcasts || []).filter((b) => b.market === 'national').map((b) => b.name).slice(0, 4),
  };
}

async function cached(file, maxAgeMs, fetcher) {
  try {
    const raw = JSON.parse(await readFile(file, 'utf8'));
    if (raw.final || Date.now() - raw.at < maxAgeMs) return raw.games;
  } catch { /* miss */ }
  const games = await fetcher();
  const final = games.length > 0 && games.every((g) => g.done || g.x) && games.every((g) => g.day < addDays(todayKey(), -1));
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify({ at: Date.now(), final, games }));
  return games;
}

async function events(url) {
  const res = await getJson(url, { retries: 3, timeout: 30000 });
  return res.json?.events || [];
}

function keepGame(league, g) {
  if (!g.home || !g.away || !g.home.id || !g.away.id) return false;
  if (US_PRESEASON.has(league) && g.seasonType === 1) return false;
  if (/all-?star|rising stars|celebrity/i.test(`${g.name} ${(g.notes || []).join(' ')}`)) return false;
  return true;
}

/** Dates to query for a day-kind season. */
async function seasonDates(league, cfg, season) {
  const [from, to] = cfg.window(season);
  // The whole season, future dates included (the simulator needs the remaining schedule).
  const last = to;
  if (cfg.noCalendar) {
    const out = [];
    for (let d = from; d <= last; d = addDays(d, 1)) out.push(d);
    return out;
  }
  // The scoreboard's calendar lists every date with games in that season.
  const probe = addDays(from, 75);
  const lg = LEAGUE_BY_KEY[league];
  const res = await getJson(`${SITE}/${lg.espn}/scoreboard?dates=${espnDate(probe)}${cfg.params || ''}`, { retries: 3, timeout: 30000 });
  const cal = res.json?.leagues?.[0]?.calendar || [];
  const dates = cal.filter((c) => typeof c === 'string').map((iso) => ptDateKey(new Date(iso)));
  const inWindow = [...new Set(dates)].filter((d) => d >= from && d <= last);
  if (inWindow.length) return inWindow;
  const out = [];
  for (let d = from; d <= last; d = addDays(d, 1)) out.push(d);
  return out;
}

/** All games of one league-season (compact), cached. */
export async function seasonGames(league, season, { concurrency = 6, refreshRecentHours = 3 } = {}) {
  const cfg = SEASONS[league];
  const lg = LEAGUE_BY_KEY[league];
  const base = `${SITE}/${lg.espn}/scoreboard`;
  const dir = join(CACHE_DIR, league);
  const maxAge = refreshRecentHours * 3600e3;
  let games = [];

  if (cfg.kind === 'day') {
    const dates = await seasonDates(league, cfg, season);
    const chunks = await mapLimit(dates, concurrency, (d) => cached(join(dir, `${d}.json`), maxAge, async () => {
      const evs = await events(`${base}?dates=${espnDate(d)}${cfg.params || ''}`);
      return evs.map((e) => parseEvent(e, league)).filter((g) => keepGame(league, g)).map((g) => compact(g, season));
    }));
    games = chunks.flatMap((c) => (Array.isArray(c) ? c : []));
  } else if (cfg.kind === 'week') {
    const reg = league === 'nfl' ? range(1, 18) : range(1, 16);
    const weeks = [...reg.map((w) => [2, w]), ...range(1, 5).map((w) => [3, w])];
    const chunks = await mapLimit(weeks, concurrency, ([type, w]) => cached(join(dir, `${season}-t${type}-w${w}.json`), maxAge, async () => {
      const evs = await events(`${base}?seasontype=${type}&week=${w}&dates=${season}${cfg.params || ''}`);
      return evs.map((e) => parseEvent(e, league)).filter((g) => keepGame(league, g)).map((g) => compact(g, season));
    }));
    games = chunks.flatMap((c) => (Array.isArray(c) ? c : []));
  } else {
    const [from, to] = cfg.window(season);
    const years = range(+from.slice(0, 4), +to.slice(0, 4));
    const chunks = await mapLimit(years, concurrency, (y) => cached(join(dir, `y${y}.json`), maxAge, async () => {
      const evs = await events(`${base}?dates=${y}&limit=1000`);
      return evs.map((e) => parseEvent(e, league)).filter((g) => keepGame(league, g)).map((g) => compact(g, null));
    }));
    games = chunks.flatMap((c) => (Array.isArray(c) ? c : []))
      .filter((g) => g.day >= from && g.day <= to)
      .map((g) => ({ ...g, season }));
  }
  const seen = new Set();
  return games
    .filter((g) => (seen.has(g.id) ? false : seen.add(g.id)))
    .sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
}

/** Every season for a league, oldest first: [{ season, games }]. */
export async function leagueHistory(league, opts) {
  const out = [];
  for (const season of SEASONS[league].seasons) {
    out.push({ season, games: await seasonGames(league, season, opts) });
  }
  return out;
}
