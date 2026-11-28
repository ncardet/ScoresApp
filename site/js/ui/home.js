// Home ("Today"): favorites pinned on top, then Live now (by current excitement), then every
// other game ranked by Watch Priority (rating + favorites + star power). League chips, date picker, pull-to-refresh,
// and auto-refresh every ~45 s while a game is live and the app is visible.

import { h, clear, fill, icon, sportIcon } from './dom.js';
import { gameRow, sectionHeader, skeletonList, appHeader, barButton, picksCarousel, watchInfo } from './components.js';
import {
  loadDay, getDay, subscribe, displayRating, rankScore, refreshLive, hasLive, dataStatus, prefetchPublishedRatings,
} from '../app/store.js';
import { todayKey, addDays, dayLabel, longDayLabel, formatClock, isValidKey } from '../core/time.js';
import { LEAGUE_BY_KEY, LEAGUES } from '../core/leagues.js';
import { favoriteFor, getSettings } from '../core/settings.js';
import { cantWatch } from '../core/watch.js';

const FILTER_KEY = 'sideline.filter';
const WATCH_KEY = 'sideline.watchable';
const REFRESH_MS = 45 * 1000;

function readFilter() {
  try { return localStorage.getItem(FILTER_KEY) || 'all'; } catch { return 'all'; }
}
function writeFilter(v) {
  try { localStorage.setItem(FILTER_KEY, v); } catch { /* ignore */ }
}
// "Only games I can watch": hide games that are on none of your services (remembered per phone).
function readWatch() {
  try { return localStorage.getItem(WATCH_KEY) === '1'; } catch { return false; }
}
function writeWatch(on) {
  try { localStorage.setItem(WATCH_KEY, on ? '1' : '0'); } catch { /* ignore */ }
}

const order = (g) => (g.state === 'in' ? 0 : g.state === 'pre' ? 1 : 2);

export function homeView(root, params = {}) {
  const dateKey = isValidKey(params.date) ? params.date : todayKey();
  let filter = readFilter();
  let watchOnly = readWatch();
  const day = getDay(dateKey);
  const listEl = h('div', { class: 'home-list' });
  const chipsEl = h('div', { class: 'chips', role: 'toolbar', 'aria-label': 'Leagues' });
  const bannerEl = h('div');
  const subEl = h('span', { class: 'meta' });
  const picksKeep = { left: 0 };
  const ptr = h('div', { class: 'ptr', 'aria-hidden': 'true' }, icon('refresh'));

  const go = (k) => { location.hash = k === todayKey() ? '#/' : `#/day/${k}`; };
  const dateInput = h('input', {
    type: 'date', class: 'date-input', value: dateKey, 'aria-label': 'Pick a date',
    onchange: (e) => { if (isValidKey(e.target.value)) go(e.target.value); },
  });
  const refreshBtn = barButton('refresh', 'Refresh', () => refresh(true));
  const watchBtn = barButton(watchOnly ? 'tvOn' : 'tv', 'Only games I can watch', () => setWatchOnly(!watchOnly));
  watchBtn.setAttribute('aria-pressed', String(watchOnly));
  watchBtn.title = 'Only games I can watch';
  const today = todayKey();
  const stripTitle = dateKey === today ? "Today's games" : dateKey < today ? 'Results' : 'Schedule';

  const top = appHeader({ title: stripTitle, meta: subEl, actions: [watchBtn, refreshBtn] });
  // Big day heading ("Today" / "Saturday"); tapping it opens the date picker.
  const rel = dayLabel(dateKey);
  const long = longDayLabel(dateKey);
  const relative = /^(Today|Tomorrow|Yesterday)$/.test(rel);
  const [weekday, ...rest] = long.split(', ');
  const dayhead = h('div', { class: 'dayhead' },
    h('label', { class: 'grow date-btn', title: 'Pick a date' },
      h('h2', { class: 'big' }, relative ? rel : weekday),
      h('div', { class: 'sub' }, relative ? long : rest.join(', '), icon('chevdown')),
      dateInput),
    h('button', { class: 'round-btn', type: 'button', 'aria-label': 'Previous day', onclick: () => go(addDays(dateKey, -1)) }, icon('left')),
    h('button', { class: 'round-btn', type: 'button', 'aria-label': 'Next day', onclick: () => go(addDays(dateKey, 1)) }, icon('right')));

  fill(root, h('div', { class: 'view' }, top, ptr, dayhead, chipsEl, bannerEl, listEl));

  function entries() {
    const out = [];
    for (const g of day.games.values()) {
      out.push({
        game: g,
        rating: displayRating(day, g.key),
        pending: (g.state !== 'pre' && !g.canceled && !(g.sport === 'racing' && !g.isRace) && !LEAGUE_BY_KEY[g.league]?.scheduleOnly && !day.ratings.get(g.key)?.current) || day.pending.has(g.key),
        fav: !!favoriteFor(g),
      });
    }
    return out;
  }

  function renderChips(all) {
    const counts = {};
    for (const e of all) counts[e.game.league] = (counts[e.game.league] || 0) + 1;
    const keys = LEAGUES.map((l) => l.key).filter((k) => counts[k]);
    if (filter !== 'all' && !counts[filter] && day.loadedOnce) filter = 'all';
    fill(chipsEl, 
      h('button', { class: 'chip', type: 'button', 'aria-pressed': String(filter === 'all'), onclick: () => setFilter('all') }, 'All', h('span', { class: 'count' }, all.length || '')),
      keys.map((k) => h('button', { class: 'chip', type: 'button', 'aria-pressed': String(filter === k), onclick: () => setFilter(k) },
        sportIcon(LEAGUE_BY_KEY[k].sport), LEAGUE_BY_KEY[k].short, h('span', { class: 'count' }, counts[k]))),
    );
  }

  function setWatchOnly(on) {
    watchOnly = on;
    writeWatch(on);
    watchBtn.setAttribute('aria-pressed', String(on));
    // The icon shows the state: a blank screen when off, ON with light coming off it when on.
    fill(watchBtn, icon(on ? 'tvOn' : 'tv'));
    render();
  }

  function setFilter(k) {
    filter = k;
    writeFilter(k);
    render();
  }

  function renderBanner() {
    const st = dataStatus(dateKey);
    clear(bannerEl);
    const updating = day.loading && day.games.size > 0;
    // Stale = a league failed outright or was served from the offline copy.
    const anyStale = !day.loading && (st.errors.length > 0 || [...day.leagues.values()].some((x) => x.stale)) && st.at;
    if (anyStale) {
      bannerEl.append(h('div', { class: 'banner', role: 'status' },
        `Couldn't reach ESPN; showing data from ${formatClock(st.at)}.`));
    }
    subEl.textContent = updating ? 'Updating…' : st.fetchedAt ? `Updated ${formatClock(st.fetchedAt)}` : '';
  }

  // Rows are rebuilt only when what they show changes: ratings arrive one game at a time, and
  // rebuilding every row (and its logos) on each one made the list flicker.
  const rowCache = new Map();
  let rowsUsed = new Set();
  const rowSig = (e, showLeague) => {
    const g = e.game;
    const r = e.rating;
    return [g.state, g.detail, g.clock, g.period, g.home?.score, g.away?.score, g.canceled, g.home?.winner, g.away?.winner,
      r?.state, r?.value, r?.pred?.low, r?.pred?.high, r?.pred?.circle?.flagged, e.pending, e.fav, showLeague,
      watchInfo(g).short, document.documentElement.dataset.theme].join('|');
  };
  function row(e, showLeague) {
    const key = e.game.key;
    const sig = rowSig(e, showLeague);
    rowsUsed.add(key);
    const hit = rowCache.get(key);
    if (hit && hit.sig === sig) return hit.el;
    const el = gameRow(e, { showLeague });
    rowCache.set(key, { sig, el });
    return el;
  }

  function render() {
    rowsUsed = new Set();
    renderList();
    for (const k of rowCache.keys()) if (!rowsUsed.has(k)) rowCache.delete(k);
  }

  function renderList() {
    const everything = entries();
    // "Only games I can watch": drop games on none of your services, favorites included.
    const services = getSettings().services;
    const all = watchOnly ? everything.filter((e) => !cantWatch(e.game, services)) : everything;
    const hidden = everything.length - all.length;
    const showHidden = () => h('button', { class: 'btn', type: 'button', onclick: () => setWatchOnly(false) }, 'Show them');
    renderChips(all);
    renderBanner();
    const pin = getSettings().pinFavorites !== false;
    const shown = all.filter((e) => filter === 'all' || e.game.league === filter);
    clear(listEl);
    if (everything.length && !all.length) {
      listEl.append(h('div', { class: 'empty' },
        h('div', { class: 'big' }, 'No games you can watch'),
        h('div', null, `${hidden} game${hidden === 1 ? " isn't" : "s aren't"} on your services.`),
        h('div', { style: { marginTop: '14px' } }, showHidden())));
      return;
    }
    if (!all.length) {
      if (day.loading || !day.loadedOnce) listEl.append(skeletonList(6));
      else {
        const allFailed = day.leagues.size > 0 && [...day.leagues.values()].every((s) => s.error);
        listEl.append(h('div', { class: 'empty' },
          h('div', { class: 'big' }, allFailed ? "Couldn't reach ESPN" : `No games ${dateKey === todayKey() ? 'today' : `on ${dayLabel(dateKey)}`}`),
          h('div', null, allFailed ? 'Check your connection and try again.' : 'Try another day with the arrows above.'),
          h('button', { class: 'btn', type: 'button', style: { marginTop: '14px' }, onclick: () => refresh(true) }, 'Retry')));
      }
      return;
    }
    const showLeague = filter === 'all';
    // Top picks: the best few games still to come (live first), or the day's best finals.
    const past = dateKey < todayKey();
    // Optional leagues without a game page (tennis, NASCAR, UFC) never make Top Picks: the cards link to game pages.
    const pool = shown.filter((e) => e.rating && !e.game.canceled && (e.game.sport !== 'racing' || e.game.isRace) && !LEAGUE_BY_KEY[e.game.league]?.noGamePage && (past ? e.game.state === 'post' : e.game.state !== 'post'));
    pool.sort((a, b) => (b.game.state === 'in') - (a.game.state === 'in') || (past ? b.rating.value - a.rating.value : rankScore(day, b.game) - rankScore(day, a.game)));
    const picks = pool.slice(0, 3);
    if (picks.length >= 2 && shown.length >= 4) {
      listEl.append(sectionHeader(past ? 'Best of the day' : 'Top picks', `${picks.length} games · swipe`), picksCarousel(picks, { keep: picksKeep }));
    }
    const favs = pin ? shown.filter((e) => e.fav) : [];
    const rest = shown.filter((e) => !pin || !e.fav);
    const live = rest.filter((e) => e.game.state === 'in');
    const others = rest.filter((e) => e.game.state !== 'in');

    if (favs.length) {
      favs.sort((a, b) => order(a.game) - order(b.game) || new Date(a.game.start) - new Date(b.game.start));
      listEl.append(sectionHeader('Favorites', `${favs.length} game${favs.length > 1 ? 's' : ''}`),
        h('div', { class: 'card list' }, favs.map((e) => row(e, showLeague))));
    }
    if (live.length) {
      live.sort((a, b) => rankScore(day, b.game) - rankScore(day, a.game));
      listEl.append(sectionHeader('Live now', `${live.length}`, { live: true }),
        h('div', { class: 'card list' }, live.map((e) => row(e, showLeague))));
    }
    if (others.length) {
      others.sort((a, b) => rankScore(day, b.game) - rankScore(day, a.game) || new Date(a.game.start) - new Date(b.game.start));
      // The strip already says Results / Schedule, so the list heading doesn't repeat it.
      const title = past ? 'All results' : live.length || favs.length || picks.length >= 2 ? 'All games' : 'Games';
      listEl.append(sectionHeader(title, 'by watch priority'),
        h('div', { class: 'card list' }, others.map((e) => row(e, showLeague))));
    }
    if (!favs.length && !live.length && !others.length) {
      listEl.append(h('div', { class: 'empty' }, h('div', { class: 'big' }, `No ${LEAGUE_BY_KEY[filter]?.short || ''} games`), 'Pick another league or day.'));
    }
    if (hidden) {
      listEl.append(h('div', { class: 'hidden-note' },
        h('span', null, `${hidden} game${hidden === 1 ? '' : 's'} hidden: not on your services`), showHidden()));
    }
  }

  async function refresh(force) {
    refreshBtn.classList.add('spin');
    try {
      if (dateKey < todayKey()) await prefetchPublishedRatings(dateKey);
      await loadDay(dateKey, { force });
    } finally {
      refreshBtn.classList.remove('spin');
      render();
    }
  }

  // Pull to refresh (iOS standalone PWAs have no native pull-to-refresh).
  let y0 = null;
  let pulled = 0;
  const onStart = (e) => { y0 = window.scrollY <= 0 && !document.querySelector('.sheet') ? e.touches[0].clientY : null; pulled = 0; };
  const onMove = (e) => {
    if (y0 == null) return;
    pulled = e.touches[0].clientY - y0;
    if (pulled <= 0) return;
    ptr.classList.add('active');
    ptr.style.height = `${Math.min(64, pulled / 2.4)}px`;
  };
  const onEnd = () => {
    if (y0 == null) return;
    ptr.classList.remove('active');
    if (pulled > 120) {
      ptr.classList.add('spin');
      ptr.style.height = '44px';
      refresh(true).finally(() => { ptr.classList.remove('spin'); ptr.style.height = '0'; });
    } else ptr.style.height = '0';
    y0 = null;
  };
  window.addEventListener('touchstart', onStart, { passive: true });
  window.addEventListener('touchmove', onMove, { passive: true });
  window.addEventListener('touchend', onEnd);

  // Auto-refresh while something is live and the app is on screen.
  const timer = setInterval(() => {
    if (document.visibilityState === 'visible' && hasLive(dateKey)) refreshLive(dateKey);
  }, REFRESH_MS);
  const onVisible = () => {
    if (document.visibilityState !== 'visible') return;
    if (Date.now() - (day.fetchedAt || 0) > 60 * 1000) refresh(false);
  };
  document.addEventListener('visibilitychange', onVisible);

  const unsub = subscribe((k) => { if (k === dateKey) render(); });
  render();
  refresh(false);

  return () => {
    unsub();
    clearInterval(timer);
    document.removeEventListener('visibilitychange', onVisible);
    window.removeEventListener('touchstart', onStart);
    window.removeEventListener('touchmove', onMove);
    window.removeEventListener('touchend', onEnd);
  };
}
