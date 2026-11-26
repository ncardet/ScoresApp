// Postseason games for brackets. ESPN has no bracket endpoint, and rejects date ranges, so:
//   NFL          scoreboard?seasontype=3&week=1..5&dates=<season>
//   NBA/NHL/MLB  one scoreboard per day across the postseason window (past days cached)
//   NCAA (bball) scoreboard?dates=<year>&groups=100   (the whole tournament in one call)
//   UCL/UEL      scoreboard?dates=<year>               (filtered to knockout stages)

import { getJson, mapLimit } from './client.js';
import { parseEvent } from './parse.js';
import { SITE } from './league.js';
import { LEAGUE_BY_KEY } from '../../core/leagues.js';
import { addDays, todayKey, espnDate } from '../../core/time.js';
import { kvGet, kvSet } from '../../core/kv.js';

// Month-day windows of each postseason (inclusive).
export const WINDOWS = {
  nba: ['04-12', '06-25'],
  nhl: ['04-15', '06-28'],
  mlb: ['09-28', '11-08'],
  nfl: ['01-07', '02-16'],
  mcbb: ['03-14', '04-10'],
  wcbb: ['03-14', '04-10'],
  ucl: ['02-10', '06-05'],
  uel: ['02-10', '05-31'],
};

const KO_SLUG = /knockout|round-of|quarterfinal|semifinal|final/i;

/**
 * The postseason to show now: the current one if it has started, else the most recent one
 * if it ended within `recentDays`. Returns { year, start, end, active } or null.
 */
export function currentWindow(league, today = todayKey(), recentDays = 120) {
  const w = WINDOWS[league];
  if (!w) return null;
  const y = +today.slice(0, 4);
  for (const year of [y, y - 1]) {
    const start = `${year}-${w[0]}`;
    const end = `${year}-${w[1]}`;
    if (today < start) continue;
    if (today <= end) return { year, start, end, active: true };
    if (today <= addDays(end, recentDays)) return { year, start, end, active: false };
  }
  return null;
}

async function dayGames(league, dateKey) {
  const lg = LEAGUE_BY_KEY[league];
  const cacheKey = `post:${league}:${dateKey}`;
  const old = dateKey < addDays(todayKey(), -2);
  if (old) {
    const hit = await kvGet(cacheKey).catch(() => null);
    if (hit) return hit;
  }
  const res = await getJson(`${SITE}/${lg.espn}/scoreboard?dates=${espnDate(dateKey)}`, { retries: 1 });
  const games = (res.json?.events || []).map((e) => parseEvent(e, league)).filter((g) => g.seasonType === 3);
  if (old) kvSet(cacheKey, games).catch(() => {});
  return games;
}

/** All postseason games for the current/most recent postseason, oldest first. */
export async function postseasonGames(league) {
  const win = currentWindow(league);
  if (!win) return { window: null, games: [] };
  const lg = LEAGUE_BY_KEY[league];
  let games = [];
  if (league === 'nfl') {
    const season = win.year - 1;
    const weeks = await mapLimit([1, 2, 3, 5], 4, (w) => getJson(`${SITE}/${lg.espn}/scoreboard?seasontype=3&week=${w}&dates=${season}`, { persist: true }));
    games = weeks.flatMap((r) => (r?.json?.events || []).map((e) => parseEvent(e, league)));
  } else if (league === 'mcbb' || league === 'wcbb') {
    const res = await getJson(`${SITE}/${lg.espn}/scoreboard?dates=${win.year}&groups=100&limit=200`, { persist: true });
    games = (res.json?.events || []).map((e) => parseEvent(e, league));
  } else if (league === 'ucl' || league === 'uel') {
    const res = await getJson(`${SITE}/${lg.espn}/scoreboard?dates=${win.year}&limit=400`, { persist: true });
    games = (res.json?.events || []).map((e) => parseEvent(e, league))
      .filter((g) => KO_SLUG.test(g.seasonSlug) && g.start.slice(0, 10) >= win.start && g.start.slice(0, 10) <= win.end);
  } else {
    const last = win.active ? todayKey() : win.end;
    const dates = [];
    for (let d = win.start; d <= last; d = addDays(d, 1)) dates.push(d);
    const days = await mapLimit(dates, 6, (d) => dayGames(league, d));
    games = days.flatMap((x) => (Array.isArray(x) ? x : []));
  }
  games.sort((a, b) => new Date(a.start) - new Date(b.start));
  return { window: win, games };
}
