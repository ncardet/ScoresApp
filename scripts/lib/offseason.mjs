// Off-season: when a league has nothing in the next HORIZON days, find the day it returns, for
// Look Ahead's "WNBA returns May 15" / "WNBA: off-season" line (written to predictions.json).

import { getJson } from '../../site/js/adapters/espn/client.js';
import { LEAGUE_BY_KEY } from '../../site/js/core/leagues.js';
import { addDays, ptDateKey, espnDate } from '../../site/js/core/time.js';

const SITE = 'https://site.api.espn.com/apis/site/v2/sports';

/**
 * First game day after `after` from an ESPN scoreboard's `leagues[0]`. ESPN's calendar is either a
 * whitelist (the listed dates have games; list-type calendars group weeks under `entries`) or, for
 * MLB, a blacklist: the listed dates are the days WITHOUT games inside calendarStartDate..EndDate.
 */
export function firstCalendarDay(lg, after) {
  const cal = lg?.calendar || [];
  if (lg?.calendarIsWhitelist === false) {
    if (!lg.calendarStartDate || !lg.calendarEndDate) return null;
    const off = new Set(cal.filter((c) => typeof c === 'string').map((iso) => ptDateKey(new Date(iso))));
    const end = ptDateKey(new Date(lg.calendarEndDate));
    let d = ptDateKey(new Date(lg.calendarStartDate));
    if (d <= after) d = addDays(after, 1);
    for (let i = 0; d <= end && i < 400; i++, d = addDays(d, 1)) if (!off.has(d)) return d;
    return null;
  }
  const days = cal
    .flatMap((c) => (typeof c === 'string' ? [c] : c?.entries?.length ? c.entries.map((e) => e.startDate) : [c?.startDate]))
    .filter(Boolean)
    .map((iso) => ptDateKey(new Date(iso)))
    .filter((d) => d > after)
    .sort();
  return days[0] || null;
}

/** First scheduled game after `after` in a cached season (compact games from lib/history). */
export function firstSeasonDay(season, after) {
  return (season || []).filter((g) => g.st === 'pre' && !g.x && g.day > after).map((g) => g.day).sort()[0] || null;
}

/**
 * When a league with nothing in the next `horizon` days returns: the first later game in its cached
 * season, else ESPN's calendar for this year and next. One read of that day says whether it's
 * preseason (spring training). Returns { returns: 'YYYY-MM-DD' | null, preseason? }.
 */
/** The last day of a scoreboard's current calendar (when its season ends), or null. */
export function calendarEnd(lg) {
  const cal = lg?.calendar || [];
  if (lg?.calendarIsWhitelist === false) return lg.calendarEndDate ? ptDateKey(new Date(lg.calendarEndDate)) : null;
  const days = cal
    .flatMap((c) => (typeof c === 'string' ? [c] : [c?.endDate || c?.startDate, ...(c?.entries || []).map((e) => e.endDate || e.startDate)]))
    .filter(Boolean)
    .map((iso) => ptDateKey(new Date(iso)))
    .sort();
  return days.at(-1) || null;
}

export async function nextScheduled(league, today, { horizon = 14, season = [] } = {}) {
  const lg = LEAGUE_BY_KEY[league];
  const after = addDays(today, horizon);
  let day = firstSeasonDay(season, after);
  let current = null;
  if (!day) {
    // The current season's calendar first, then this year's and next year's.
    const year = +today.slice(0, 4);
    for (const q of ['', `?dates=${year}`, `?dates=${year + 1}`]) {
      const res = await getJson(`${SITE}/${lg.espn}/scoreboard${q}`, { retries: 2, timeout: 20000 }).catch(() => null);
      const L = res?.json?.leagues?.[0];
      if (q === '') current = L;
      day = firstCalendarDay(L, after);
      if (day) break;
    }
  }
  if (!day) {
    // No date found. Inside the current season it's a break (matchdays can be weeks apart), not
    // the off-season.
    const end = calendarEnd(current);
    return end && end > today ? { returns: null, inSeason: true } : { returns: null };
  }
  const sb = await getJson(`${SITE}/${lg.espn}/scoreboard?dates=${espnDate(day)}`, { retries: 2, timeout: 20000 }).catch(() => null);
  const events = sb?.json?.events || [];
  const preseason = events.length > 0 && events.every((e) => e.season?.type === 1);
  return preseason ? { returns: day, preseason: true } : { returns: day };
}

/**
 * Tennis: the next Grand Slam. ESPN's ATP calendar lists every tournament, so read the scoreboard
 * inside each major's usual window (Melbourne, Paris, London, New York) and take the first major
 * that starts after the horizon.
 */
export async function nextSlam(today, { horizon = 14 } = {}) {
  const after = addDays(today, horizon);
  const year = +today.slice(0, 4);
  for (const y of [year, year + 1]) {
    for (const md of ['01-22', '05-31', '07-05', '09-02']) {
      const probe = `${y}-${md}`;
      if (probe <= today) continue;
      const res = await getJson(`${SITE}/tennis/atp/scoreboard?dates=${espnDate(probe)}`, { retries: 2, timeout: 20000 }).catch(() => null);
      const major = (res?.json?.events || []).find((e) => e.major);
      const start = major?.date && ptDateKey(new Date(major.date));
      if (start && start > after) return { returns: start, event: major.name };
    }
  }
  return { returns: null };
}
