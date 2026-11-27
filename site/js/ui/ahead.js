// Look Ahead: the next 14 days of predictions, grouped by day and ordered by Watch Priority,
// with league / favorites filters and a "Circle this one" list of flagged games further out.
// Data: data/predictions.json (nightly). Games 0-2 days out are re-predicted with the latest
// odds from the scoreboard when that day is loaded.

import { h, fill, logo, teamLogo } from './dom.js';
import { badgeWithRange, sectionHeader, skeletonList, watchInfo } from './components.js';
import { loadPredictions, getDay, loadDay } from '../app/store.js';
import { predict } from '../rating/index.js';
import { LEAGUE_BY_KEY, LEAGUES } from '../core/leagues.js';
import { todayKey, addDays, dayLabel, longDayLabel, formatTime } from '../core/time.js';
import { getSettings, favoriteFor } from '../core/settings.js';

const KEY = 'sideline.aheadFilter';

function entryGame(e) {
  const lg = LEAGUE_BY_KEY[e.league];
  const team = (t) => t && ({ ...t, name: t.short, logoDark: '' });
  return {
    key: e.key, id: e.id, eventId: e.eventId, league: e.league, sport: lg?.sport, start: e.start, state: 'pre',
    home: team(e.home), away: team(e.away), notes: e.notes || [], neutral: !!e.neutral,
    broadcasts: (e.broadcasts || []).map((name) => ({ name, market: 'national' })), odds: null,
    isRace: e.session === 'Race', circuit: e.circuit, gpName: e.gpName, session: e.session, sessionLabel: 'Race', drivers: [],
  };
}

function aheadRow(e, game, rating) {
  const lg = LEAGUE_BY_KEY[e.league];
  const fav = favoriteFor(game);
  const w = watchInfo(game);
  const p = rating?.pred;
  const href = `#/game/${e.league}/${encodeURIComponent(e.id)}${e.eventId ? `?e=${e.eventId}` : ''}`;
  const teams = game.sport === 'racing'
    ? h('div', { class: 'teams' }, h('div', { class: 'race-title' }, `${e.gpName || 'Grand Prix'} · Race`), h('div', { class: 'race-sub' }, e.circuit || ''))
    : h('div', { class: 'teams' }, [game.away, game.home].map((t) => h('div', { class: 'team-line' },
      logo(teamLogo(t), ''),
      h('div', { class: 'team-name' }, t.rank ? h('span', { class: 'rank' }, t.rank) : null, t.short, fav && String(fav.id) === t.id ? h('span', { class: 'star' }, '★') : null),
      h('span'))));
  return h('a', { class: 'game-row', href },
    fav ? h('span', { class: 'fav-flag', 'aria-hidden': 'true' }) : null,
    rating ? badgeWithRange(rating) : h('span', { class: 'badge none' }, '—'),
    h('div', { class: 'ahead-main' }, teams,
      p ? h('div', { class: 'ahead-meta' }, p.circle?.flagged ? h('span', { class: 'circle-badge', title: 'Circle this one' }, '◎') : null,
        `${Math.round(p.pGreat * 100)}% chance of Great`) : null,
      p?.reasons?.[0] ? h('div', { class: 'ahead-reason' }, p.reasons.slice(0, 2).map((r) => r.text).join(' · ')) : null),
    h('div', { class: 'row-side' },
      h('div', { class: 'league-tag' }, lg?.short || e.league),
      h('div', { class: 'status' }, formatTime(e.start)),
      p ? h('span', { class: 'horizon' }, p.horizon.label) : null,
      w.status === 'ok' ? h('div', { class: 'watch' }, w.short) : null));
}

export function aheadView(root) {
  let filter = (() => { try { return localStorage.getItem(KEY) || 'all'; } catch { return 'all'; } })();
  const chips = h('div', { class: 'chips', role: 'toolbar', 'aria-label': 'Filter' });
  const body = h('div');
  fill(root, h('div', { class: 'view' },
    h('header', { class: 'topbar' }, h('div', { class: 'title-row' }, h('h1', { class: 'title' }, 'Look Ahead')),
      h('div', { class: 'subtitle' }, 'Next 14 days, ranked by what is worth watching'), chips),
    body));
  let alive = true;
  let data = null;

  function setFilter(f) {
    filter = f;
    try { localStorage.setItem(KEY, f); } catch { /* ignore */ }
    render();
  }

  function render() {
    if (!data) { fill(body, skeletonList(6)); return; }
    const today = todayKey();
    const hidden = new Set(getSettings().hiddenLeagues);
    const entries = (data.data?.games || []).filter((e) => !hidden.has(e.league) && e.day >= today && e.day <= addDays(today, 14));
    const leagues = LEAGUES.map((l) => l.key).filter((k) => entries.some((e) => e.league === k));
    fill(chips,
      h('button', { class: 'chip', type: 'button', 'aria-pressed': String(filter === 'all'), onclick: () => setFilter('all') }, 'All'),
      h('button', { class: 'chip', type: 'button', 'aria-pressed': String(filter === 'fav'), onclick: () => setFilter('fav') }, '★ Favorites'),
      leagues.map((k) => h('button', { class: 'chip', type: 'button', 'aria-pressed': String(filter === k), onclick: () => setFilter(k) }, LEAGUE_BY_KEY[k].short)));
    const favs = getSettings().favorites;
    const rows = [];
    for (const e of entries) {
      let game = entryGame(e);
      // 0-2 days out: use the scoreboard (current odds, injuries) when that day is loaded.
      const live = getDay(e.day).games.get(e.key);
      if (live) {
        if (live.state !== 'pre') continue;
        game = live;
      }
      if (filter === 'fav' && !favoriteFor(game)) continue;
      if (filter !== 'all' && filter !== 'fav' && e.league !== filter) continue;
      const rating = predict(game, null, { ...(e.inputs || {}), favorites: favs });
      rows.push({ e, game, rating });
    }
    const byDay = new Map();
    for (const r of rows) {
      if (!byDay.has(r.e.day)) byDay.set(r.e.day, []);
      byDay.get(r.e.day).push(r);
    }
    const parts = [];
    for (const day of [...byDay.keys()].sort()) {
      const list = byDay.get(day).sort((a, b) => (b.rating?.pred?.priority ?? 0) - (a.rating?.pred?.priority ?? 0));
      const rel = dayLabel(day, today);
      const title = /^(Today|Tomorrow)$/.test(rel) ? `${rel} · ${longDayLabel(day).replace(/^\w+, /, '')}` : longDayLabel(day);
      parts.push(sectionHeader(title, `${list.length} game${list.length === 1 ? '' : 's'}`),
        h('div', { class: 'card list' }, list.map((r) => aheadRow(r.e, r.game, r.rating))));
    }
    if (!rows.length) parts.push(h('div', { class: 'empty' }, h('div', { class: 'big' }, filter === 'fav' ? 'No favorites in the next 14 days' : 'Nothing scheduled'), data.data ? 'Predictions refresh every night.' : "Predictions haven't been published yet (the nightly job writes data/predictions.json)."));
    const circle = (data.circle || []).filter((c) => !hidden.has(c.league) && (filter === 'all' || filter === c.league || (filter === 'fav' && favoriteFor({ ...entryGame(c), league: c.league }))));
    if (circle.length) {
      parts.push(sectionHeader('Circle this one', 'further out'),
        h('div', { class: 'card list' }, circle.map((c) => h('div', { class: 'circle-row' },
          h('div', { class: 'when' }, `${LEAGUE_BY_KEY[c.league]?.short || c.league} · ${longDayLabel(c.day)}`),
          h('div', { class: 'team-name' }, h('span', { class: 'circle-badge' }, '◎'), c.away && c.home ? `${c.away.short} at ${c.home.short}` : c.gpName || 'Race'),
          h('div', { class: 'flags' }, c.reasons.join(' · '))))));
    }
    if (data.data?.generated_at) parts.push(h('p', { class: 'tiny', style: { margin: '14px 4px' } }, `Predictions generated ${new Date(data.data.generated_at).toLocaleString('en-US', { timeZone: 'America/Los_Angeles', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} PT. Numbers are objective; order includes your favorites and star power.`));
    fill(body, parts);
  }

  render();
  loadPredictions().then((d) => { if (!alive) return; data = d; render(); });
  // Refresh the next two days' scoreboards so their predictions use current odds.
  for (const d of [todayKey(), addDays(todayKey(), 1), addDays(todayKey(), 2)]) {
    loadDay(d).then(() => { if (alive && data) render(); }).catch(() => {});
  }
  return () => { alive = false; };
}
