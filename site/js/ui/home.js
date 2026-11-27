// Home ("Today"): favorites pinned on top, then Live now (by current excitement), then every
// other game ranked by Watch Priority (rating + favorites + star power). League chips, date picker, pull-to-refresh,
// and auto-refresh every ~45 s while a game is live and the app is visible.

import { h, clear, fill, icon } from './dom.js';
import { gameRow, sectionHeader, skeletonList } from './components.js';
import {
  loadDay, getDay, subscribe, displayRating, rankScore, refreshLive, hasLive, dataStatus, prefetchPublishedRatings,
} from '../app/store.js';
import { todayKey, addDays, dayLabel, longDayLabel, formatClock, isValidKey } from '../core/time.js';
import { LEAGUE_BY_KEY, LEAGUES } from '../core/leagues.js';
import { favoriteFor, getSettings } from '../core/settings.js';

const FILTER_KEY = 'sideline.filter';
const REFRESH_MS = 45 * 1000;

function readFilter() {
  try { return localStorage.getItem(FILTER_KEY) || 'all'; } catch { return 'all'; }
}
function writeFilter(v) {
  try { localStorage.setItem(FILTER_KEY, v); } catch { /* ignore */ }
}

const order = (g) => (g.state === 'in' ? 0 : g.state === 'pre' ? 1 : 2);

export function homeView(root, params = {}) {
  const dateKey = isValidKey(params.date) ? params.date : todayKey();
  let filter = readFilter();
  const day = getDay(dateKey);
  const listEl = h('div', { class: 'home-list' });
  const chipsEl = h('div', { class: 'chips', role: 'toolbar', 'aria-label': 'Leagues' });
  const bannerEl = h('div');
  const subEl = h('div', { class: 'subtitle' });
  const ptr = h('div', { class: 'ptr', 'aria-hidden': 'true' }, icon('refresh'));

  const go = (k) => { location.hash = k === todayKey() ? '#/' : `#/day/${k}`; };
  const dateInput = h('input', {
    type: 'date', class: 'date-input', value: dateKey, 'aria-label': 'Pick a date',
    onchange: (e) => { if (isValidKey(e.target.value)) go(e.target.value); },
  });
  const refreshBtn = h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Refresh', onclick: () => refresh(true) }, icon('refresh'));

  const top = h('header', { class: 'topbar' },
    h('div', { class: 'title-row' },
      h('h1', { class: 'title' }, dayLabel(dateKey)),
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Previous day', onclick: () => go(addDays(dateKey, -1)) }, icon('left')),
      h('span', { class: 'icon-btn date-btn' }, icon('calendar'), dateInput),
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Next day', onclick: () => go(addDays(dateKey, 1)) }, icon('right')),
      refreshBtn),
    subEl,
    chipsEl);

  fill(root, h('div', { class: 'view' }, top, ptr, bannerEl, listEl));

  function entries() {
    const out = [];
    for (const g of day.games.values()) {
      out.push({
        game: g,
        rating: displayRating(day, g.key),
        pending: (g.state !== 'pre' && !g.canceled && !(g.sport === 'racing' && !g.isRace) && !day.ratings.get(g.key)?.current) || day.pending.has(g.key),
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
        LEAGUE_BY_KEY[k].short, h('span', { class: 'count' }, counts[k]))),
    );
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
    subEl.textContent = `${longDayLabel(dateKey)}${updating ? ' · Updating…' : st.fetchedAt ? ` · Updated ${formatClock(st.fetchedAt)}` : ''}`;
  }

  function render() {
    const all = entries();
    renderChips(all);
    renderBanner();
    const pin = getSettings().pinFavorites !== false;
    const shown = all.filter((e) => filter === 'all' || e.game.league === filter);
    clear(listEl);
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
    const favs = pin ? shown.filter((e) => e.fav) : [];
    const rest = shown.filter((e) => !pin || !e.fav);
    const live = rest.filter((e) => e.game.state === 'in');
    const others = rest.filter((e) => e.game.state !== 'in');

    if (favs.length) {
      favs.sort((a, b) => order(a.game) - order(b.game) || new Date(a.game.start) - new Date(b.game.start));
      listEl.append(sectionHeader('Favorites', `${favs.length} game${favs.length > 1 ? 's' : ''}`),
        h('div', { class: 'card list' }, favs.map((e) => gameRow(e, { showLeague }))));
    }
    if (live.length) {
      live.sort((a, b) => rankScore(day, b.game) - rankScore(day, a.game));
      listEl.append(sectionHeader('Live now', `${live.length}`, { live: true }),
        h('div', { class: 'card list' }, live.map((e) => gameRow(e, { showLeague }))));
    }
    if (others.length) {
      others.sort((a, b) => rankScore(day, b.game) - rankScore(day, a.game) || new Date(a.game.start) - new Date(b.game.start));
      const past = dateKey < todayKey();
      const title = past ? 'Results' : dateKey > todayKey() ? 'Schedule' : live.length || favs.length ? 'All games' : 'Games';
      listEl.append(sectionHeader(title, 'by watch priority'),
        h('div', { class: 'card list' }, others.map((e) => gameRow(e, { showLeague }))));
    }
    if (!favs.length && !live.length && !others.length) {
      listEl.append(h('div', { class: 'empty' }, h('div', { class: 'big' }, `No ${LEAGUE_BY_KEY[filter]?.short || ''} games`), 'Pick another league or day.'));
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
