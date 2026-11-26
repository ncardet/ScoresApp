// App data layer: loads a day's games from every enabled league, rates them, caches what it can.
//
//   - Scoreboards for all enabled leagues are fetched in parallel (ESPN allows CORS).
//   - Pre-game: predicted rating straight from the scoreboard.
//   - Live / final: the game summary is fetched (priority: favorites, live, then finals) and rated.
//   - Final ratings are frozen and stored in IndexedDB, so each finished game is fetched once.
//   - The last loaded day is snapshotted so the app opens instantly and works offline.

import { ADAPTERS } from '../adapters/index.js';
import { getJson } from '../adapters/espn/client.js';
import { getCalibration, predict, rate, predictF1, ENGINE_VERSION } from '../rating/index.js';
import { kvGet, kvSet, kvKeys, kvDel } from '../core/kv.js';
import { enabledLeagues, favoriteTeamIds, favoriteFor, getSettings } from '../core/settings.js';
import { todayKey, addDays } from '../core/time.js';
import { LEAGUE_BY_KEY } from '../core/leagues.js';

const LIVE_DETAIL_TTL = 55 * 1000;
const DETAIL_CONCURRENCY = 4;
const SNAPSHOT_DAYS = 5;
export const FAVORITE_BOOST = 8;

const days = new Map(); // dateKey -> DayState
const details = new Map(); // game key -> { detail, at }
const listeners = new Set();
let f1Standings = null;

function newDay(dateKey) {
  return {
    dateKey,
    games: new Map(), // key -> game
    ratings: new Map(), // key -> { predicted, current }
    leagues: new Map(), // league -> { at, stale, error }
    pending: new Set(), // keys with a detail request in flight or queued
    loading: false,
    loadedOnce: false,
    fetchedAt: 0,
    snapshotAt: 0,
  };
}

export function getDay(dateKey) {
  if (!days.has(dateKey)) days.set(dateKey, newDay(dateKey));
  return days.get(dateKey);
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

let scheduled = new Set();
let raf = 0;
function notify(dateKey) {
  scheduled.add(dateKey);
  if (raf) return;
  const run = () => {
    raf = 0;
    const keys = scheduled;
    scheduled = new Set();
    for (const k of keys) for (const fn of listeners) fn(k);
  };
  raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame(run) : setTimeout(run, 16);
}

// ---------- snapshot (instant open + offline) ----------

async function restoreSnapshot(day) {
  const snap = await kvGet(`day:${day.dateKey}`).catch(() => null);
  if (!snap || day.games.size) return;
  for (const g of snap.games || []) day.games.set(g.key, g);
  for (const [k, r] of snap.ratings || []) day.ratings.set(k, r);
  for (const [k, s] of snap.leagues || []) day.leagues.set(k, s);
  day.snapshotAt = snap.at || 0;
  day.fetchedAt = snap.at || 0;
  notify(day.dateKey);
}

let saveTimer = null;
function saveSnapshot(day) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    const snap = {
      at: day.fetchedAt || Date.now(),
      games: [...day.games.values()],
      ratings: [...day.ratings.entries()],
      leagues: [...day.leagues.entries()],
    };
    await kvSet(`day:${day.dateKey}`, snap).catch(() => {});
    // Keep only the most recent few days.
    const keys = (await kvKeys('day:').catch(() => [])).sort();
    for (const k of keys.slice(0, Math.max(0, keys.length - SNAPSHOT_DAYS))) kvDel(k).catch(() => {});
  }, 800);
}

// ---------- ratings ----------

async function f1StandingsCached() {
  if (f1Standings && Date.now() - f1Standings.at < 3600e3) return f1Standings.data;
  try {
    const data = await ADAPTERS.f1.standings();
    f1Standings = { at: Date.now(), data };
    return data;
  } catch {
    return f1Standings?.data || null;
  }
}

async function predictedFor(game) {
  const cal = await getCalibration(game.league);
  if (game.sport === 'racing') {
    if (!game.isRace) return null;
    return predictF1(game, cal, await f1StandingsCached());
  }
  return predict(game, cal);
}

const finalKey = (game) => `rating:${game.key}:v${ENGINE_VERSION}`;

/** Fill predicted ratings and cached finals; queue detail fetches for live/final games. */
async function rateLeague(day, leagueKey) {
  const games = [...day.games.values()].filter((g) => g.league === leagueKey);
  for (const g of games) {
    const r = day.ratings.get(g.key) || { predicted: null, current: null };
    try {
      if (!r.predicted || g.state === 'pre') r.predicted = await predictedFor(g);
    } catch (e) {
      console.warn('predict failed', g.key, e);
    }
    if (g.state === 'post' && !g.canceled && (!r.current || r.current.state !== 'final')) {
      const cached = await kvGet(finalKey(g)).catch(() => null);
      if (cached) r.current = cached;
    }
    day.ratings.set(g.key, r);
  }
  notify(day.dateKey);
}

function needsDetail(day, g) {
  if (g.canceled) return false;
  if (g.sport === 'racing' && !g.isRace) return false;
  const r = day.ratings.get(g.key);
  if (g.state === 'post') return !r?.current || r.current.state !== 'final';
  if (g.state === 'in') {
    const d = details.get(g.key);
    return !d || Date.now() - d.at > LIVE_DETAIL_TTL;
  }
  return false;
}

const queue = [];
let active = 0;

function priority(day, g) {
  const fav = favoriteFor(g) ? 0 : 1;
  const live = g.state === 'in' ? 0 : 1;
  return fav * 10 + live * 5 + (day.dateKey === todayKey() ? 0 : 1);
}

function enqueueDetails(day) {
  const want = [...day.games.values()].filter((g) => needsDetail(day, g) && !day.pending.has(g.key));
  want.sort((a, b) => priority(day, a) - priority(day, b) || new Date(b.start) - new Date(a.start));
  for (const g of want) {
    day.pending.add(g.key);
    queue.push({ day, key: g.key });
  }
  pump();
  notify(day.dateKey);
}

function pump() {
  while (active < DETAIL_CONCURRENCY && queue.length) {
    const job = queue.shift();
    active++;
    rateFromDetail(job.day, job.key)
      .catch((e) => console.warn('detail failed', job.key, e?.message || e))
      .finally(() => {
        active--;
        job.day.pending.delete(job.key);
        notify(job.day.dateKey);
        pump();
      });
  }
}

async function rateFromDetail(day, key) {
  const game = day.games.get(key);
  if (!game) return;
  const detail = await loadDetail(game);
  const r = day.ratings.get(key) || { predicted: null, current: null };
  const cal = await getCalibration(game.league);
  const rating = rate(detail, cal, { predicted: r.predicted });
  // The summary can be newer than the scoreboard (game just ended): keep the fresher status.
  if (detail.game?.state && detail.game.state !== game.state) day.games.set(key, { ...game, ...pickStatus(detail.game) });
  if (rating) {
    r.current = rating.state === 'predicted' ? r.current : rating;
    if (rating.state === 'final') kvSet(finalKey(game), rating).catch(() => {});
  }
  day.ratings.set(key, r);
  saveSnapshot(day);
}

function pickStatus(g) {
  const { state, completed, canceled, period, clock, detail, home, away } = g;
  return { state, completed, canceled, period, clock, detail, home, away };
}

/** Load (or reuse) a game's detail. */
export async function loadDetail(game, { force = false } = {}) {
  const cached = details.get(game.key);
  const ttl = game.state === 'in' ? LIVE_DETAIL_TTL : game.state === 'post' ? 6 * 3600e3 : 10 * 60e3;
  if (!force && cached && Date.now() - cached.at < ttl) return cached.detail;
  const a = ADAPTERS[game.league];
  const detail = await a.summary(game, { persist: true });
  details.set(game.key, { detail, at: Date.now() });
  // Keep the in-memory detail cache small.
  if (details.size > 40) details.delete(details.keys().next().value);
  return detail;
}

// ---------- day loading ----------

/**
 * Load a day. Restores the snapshot first, then fetches every enabled league.
 * @returns {Promise<void>} resolves when scoreboards are in (ratings keep arriving after).
 */
export async function loadDay(dateKey, { force = false } = {}) {
  const day = getDay(dateKey);
  if (!day.loadedOnce) await restoreSnapshot(day);
  if (day.loading) return day.loading;
  if (!force && day.fetchedAt && Date.now() - day.fetchedAt < 20 * 1000 && !day.snapshotAt) return undefined;
  const run = (async () => {
    const leagues = enabledLeagues();
    await Promise.all(leagues.map(async (lg) => {
      try {
        const res = await ADAPTERS[lg.key].scoreboard(dateKey, { favoriteTeamIds: favoriteTeamIds(lg.key), persist: true });
        for (const [k, g] of day.games) if (g.league === lg.key) day.games.delete(k);
        for (const g of res.games) day.games.set(g.key, g);
        day.leagues.set(lg.key, { at: res.at, stale: !!res.stale, error: null, count: res.games.length });
      } catch (e) {
        const prev = day.leagues.get(lg.key);
        day.leagues.set(lg.key, { ...(prev || {}), error: String(e?.message || e), stale: true });
      }
      await rateLeague(day, lg.key);
    }));
    // Drop games from leagues the user has hidden since the snapshot.
    const enabled = new Set(leagues.map((l) => l.key));
    for (const [k, g] of day.games) if (!enabled.has(g.league)) day.games.delete(k);
    day.fetchedAt = Date.now();
    day.snapshotAt = 0;
    day.loadedOnce = true;
    enqueueDetails(day);
    saveSnapshot(day);
  })();
  day.loading = run;
  try {
    await run;
  } finally {
    day.loading = false;
    notify(dateKey);
  }
  return undefined;
}

/** Light refresh for auto-update: scoreboards of leagues with live/imminent games, then live details. */
export async function refreshLive(dateKey) {
  const day = getDay(dateKey);
  const soon = Date.now() + 20 * 60e3;
  const leagues = new Set();
  for (const g of day.games.values()) {
    if (g.state === 'in' || (g.state === 'pre' && new Date(g.start).getTime() < soon)) leagues.add(g.league);
  }
  await Promise.all([...leagues].map(async (key) => {
    try {
      const res = await ADAPTERS[key].scoreboard(dateKey, { favoriteTeamIds: favoriteTeamIds(key), persist: true });
      for (const [k, g] of day.games) if (g.league === key) day.games.delete(k);
      for (const g of res.games) day.games.set(g.key, g);
      day.leagues.set(key, { at: res.at, stale: !!res.stale, error: null, count: res.games.length });
      await rateLeague(day, key);
    } catch (e) {
      const prev = day.leagues.get(key);
      day.leagues.set(key, { ...(prev || {}), error: String(e?.message || e), stale: true });
    }
  }));
  day.fetchedAt = Date.now();
  enqueueDetails(day);
  saveSnapshot(day);
  notify(dateKey);
}

export function hasLive(dateKey) {
  const day = days.get(dateKey);
  if (!day) return false;
  return [...day.games.values()].some((g) => g.state === 'in');
}

/** Displayed rating for a game: live/final when known, else predicted. */
export function displayRating(day, key) {
  const r = day.ratings.get(key);
  const g = day.games.get(key);
  if (!r) return null;
  if (r.current) return r.current;
  if (g?.state === 'pre' || g?.canceled) return r.predicted;
  // Live/final without a computed rating yet: fall back to the prediction (shown with spinner).
  return null;
}

/** Sort key: rating (+ a modest boost for favorites). */
export function rankScore(day, game) {
  const rating = displayRating(day, game.key) || day.ratings.get(game.key)?.predicted;
  const base = rating?.value ?? 45;
  return base + (favoriteFor(game) ? FAVORITE_BOOST : 0);
}

/** Oldest data timestamp across leagues for the "showing data from" banner. */
export function dataStatus(dateKey) {
  const day = days.get(dateKey);
  if (!day) return { stale: false, at: 0, errors: [] };
  const entries = [...day.leagues.entries()];
  const errors = entries.filter(([, s]) => s.error).map(([k]) => k);
  const staleEntries = entries.filter(([, s]) => s.stale);
  const at = staleEntries.length ? Math.min(...staleEntries.map(([, s]) => s.at || Date.now())) : day.fetchedAt;
  return { stale: staleEntries.length > 0 || !!day.snapshotAt, at: at || day.snapshotAt, errors, fetchedAt: day.fetchedAt, fromSnapshot: !!day.snapshotAt };
}

/** Find a game in any loaded day, or fetch it directly (deep links). */
export async function findGame(league, id, { eventId } = {}) {
  for (const day of days.values()) {
    for (const g of day.games.values()) if (g.league === league && g.id === id) return { game: g, day };
  }
  // Not loaded: F1 needs the weekend; team sports can be rebuilt from the summary header.
  if (league === 'f1') {
    const today = todayKey();
    for (const d of [today, addDays(today, -1), addDays(today, 1)]) {
      const res = await ADAPTERS.f1.scoreboard(d).catch(() => null);
      const g = res?.games.find((x) => x.id === id && (!eventId || x.eventId === eventId));
      if (g) return { game: g, day: null };
    }
    return null;
  }
  const lg = LEAGUE_BY_KEY[league];
  if (!lg) return null;
  const a = ADAPTERS[league];
  const detail = await a.summary({ id, league, key: `${league}:${id}` }, { persist: true });
  details.set(detail.game.key, { detail, at: Date.now() });
  return { game: detail.game, day: null, detail };
}

/** Rating for the game page (uses the day state when present). */
export async function ratingForGame(game, detail, day) {
  const cal = await getCalibration(game.league);
  const r = day?.ratings.get(game.key) || { predicted: null, current: null };
  if (!r.predicted) r.predicted = await predictedFor(game).catch(() => null);
  let current = r.current;
  if (game.state !== 'pre' && detail) {
    current = rate(detail, cal, { predicted: r.predicted });
    if (current?.state === 'final') kvSet(finalKey(game), current).catch(() => {});
  }
  if (day) { r.current = current?.state === 'predicted' ? r.current : current; day.ratings.set(game.key, r); }
  return { predicted: r.predicted, current: current || null };
}

export async function clearCaches() {
  const keys = await kvKeys('');
  await Promise.all(keys.map((k) => kvDel(k)));
  days.clear();
  details.clear();
}

export function lastUpdate() {
  let at = 0;
  for (const d of days.values()) at = Math.max(at, d.fetchedAt || 0);
  return at;
}

/** Ratings published by the morning-brief job (yesterday's finals), used as a head start. */
export async function prefetchPublishedRatings(dateKey) {
  try {
    const res = await getJson(new URL(`../../data/ratings/${dateKey}.json`, import.meta.url).href, { timeout: 4000, retries: 0 });
    const day = getDay(dateKey);
    for (const [key, rating] of Object.entries(res.json?.ratings || {})) {
      if (rating?.engine !== ENGINE_VERSION) continue;
      const r = day.ratings.get(key) || { predicted: null, current: null };
      if (!r.current) { r.current = rating; day.ratings.set(key, r); kvSet(`rating:${key}:v${ENGINE_VERSION}`, rating).catch(() => {}); }
    }
    notify(dateKey);
  } catch { /* not published for this date */ }
}

export { getSettings };
