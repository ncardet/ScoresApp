// Shared UI pieces: rating badge, explanation sheet, game rows, section headers.

import { h, icon, logo, teamLogo } from './dom.js';
import { formatTime } from '../core/time.js';
import { whereToWatch } from '../core/watch.js';
import { getSettings, favoriteFor } from '../core/settings.js';
import { LEAGUE_BY_KEY } from '../core/leagues.js';

const STATE_LABEL = { predicted: 'Predicted', live: 'Live', final: 'Final' };

/** Rating badge. `rating` may be null (unrated) and `pending` shows a spinner. */
export function badge(rating, { size = '', pending = false, onTap } = {}) {
  if (pending && !rating) {
    return h('span', { class: `badge pending ${size}`, 'aria-label': 'Rating loading' });
  }
  if (!rating) return h('span', { class: `badge none ${size}`, 'aria-label': 'Not rated' }, '—');
  const el = h('button', {
    class: `badge ${size}${pending ? ' refreshing' : ''}`,
    type: 'button',
    'data-band': rating.band.key,
    'data-state': rating.state,
    'aria-label': `${STATE_LABEL[rating.state]} excitement ${rating.value}, ${rating.band.label}. Tap for why.`,
  }, String(rating.value));
  el.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (onTap) onTap(); else openRatingSheet(rating);
  });
  return el;
}

const COMP_LABEL = {
  swing: 'Momentum swings', closeness: 'Late closeness', leadChanges: 'Lead changes', comeback: 'Comeback',
  novelty: 'Rare moments', pace: 'Scoring pace', stakes: 'Stakes',
  overtakes: 'Overtakes', finalGap: 'Fight for the win', incidents: 'Safety cars / flags',
};

let openSheet = null;

export function closeSheet() {
  if (!openSheet) return;
  const { sheet, backdrop } = openSheet;
  sheet.classList.remove('open');
  backdrop.classList.remove('open');
  setTimeout(() => { sheet.remove(); backdrop.remove(); }, 250);
  openSheet = null;
}

/** Bottom sheet explaining a rating in plain English. */
export function openRatingSheet(rating, { title = '', predicted = null } = {}) {
  closeSheet();
  const backdrop = h('div', { class: 'sheet-backdrop', onclick: closeSheet });
  const reasons = rating.reasons?.length ? rating.reasons : [{ text: 'Not much to report yet', tone: '-' }];
  const comps = rating.components ? Object.entries(rating.components) : [];
  const sheet = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Why this rating' },
    h('div', { class: 'grab' }),
    h('div', { class: 'explain-head' },
      h('span', { class: 'badge lg', 'data-band': rating.band.key, 'data-state': rating.state }, String(rating.value)),
      h('div', null,
        h('h3', null, `${rating.band.label}`),
        h('div', { class: 'muted' }, `${STATE_LABEL[rating.state]} rating${rating.state === 'live' ? ' · updates as the game goes' : rating.state === 'final' ? ' · frozen' : ' · before the game'}`),
        title ? h('div', { class: 'tiny' }, title) : null)),
    h('ul', { class: 'reasons' }, reasons.map((r) => h('li', { class: r.tone === '-' ? 'neg' : '' }, r.text))),
    predicted && rating.state !== 'predicted' ? h('p', { class: 'muted' }, `Predicted before the game: ${predicted.value} (${predicted.band.label}).`) : null,
    comps.length ? h('div', { class: 'comp-bars' }, comps.map(([k, v]) => h('div', { class: 'comp' },
      h('span', null, COMP_LABEL[k] || k),
      h('span', { class: 'bar' }, h('i', { style: { width: `${Math.round(v * 100)}%` } })),
      h('span', { class: 'tiny' }, Math.round(v * 100))))) : null,
    h('p', { class: 'tiny', style: { marginTop: '14px' } },
      '0–39 Dull · 40–64 OK · 65–84 Good · 85–100 Great. 50 is a median game for its league.'),
  );
  document.body.append(backdrop, sheet);
  requestAnimationFrame(() => { backdrop.classList.add('open'); sheet.classList.add('open'); });
  // Swipe down to close.
  let y0 = null;
  sheet.addEventListener('touchstart', (e) => { if (sheet.scrollTop <= 0) y0 = e.touches[0].clientY; }, { passive: true });
  sheet.addEventListener('touchmove', (e) => {
    if (y0 == null) return;
    const dy = e.touches[0].clientY - y0;
    if (dy > 0) sheet.style.transform = `translateY(${dy}px)`;
  }, { passive: true });
  sheet.addEventListener('touchend', (e) => {
    if (y0 == null) return;
    const dy = e.changedTouches[0].clientY - y0;
    sheet.style.transform = '';
    y0 = null;
    if (dy > 80) closeSheet();
  });
  openSheet = { sheet, backdrop };
}

document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheet(); });

/** Status text for a row: start time (PT), live clock, or final. */
export function statusInfo(game) {
  if (game.canceled) return { text: game.detail || 'Postponed', cls: 'final' };
  if (game.state === 'pre') return { text: formatTime(game.start), cls: '' };
  if (game.state === 'in') {
    let text = game.detail || 'Live';
    if (game.sport === 'soccer' && game.clock && !/half/i.test(text)) text = game.clock;
    return { text, cls: 'live' };
  }
  return { text: game.detail || 'Final', cls: 'final' };
}

export function watchInfo(game) {
  return whereToWatch(game.broadcasts, getSettings().services);
}

function teamLine(team, game, other, fav) {
  const final = game.state === 'post' && !game.canceled;
  const lost = final && team.score != null && other.score != null && (other.winner || (!team.winner && team.score < other.score));
  const showScore = game.state !== 'pre' && team.score != null;
  const isFav = fav && String(fav.id) === team.id;
  return h('div', { class: `team-line${lost ? ' loser' : ''}` },
    logo(teamLogo(team), ''),
    h('div', { class: 'team-name' },
      team.rank ? h('span', { class: 'rank' }, team.rank) : null,
      team.short || team.name,
      isFav ? h('span', { class: 'star', 'aria-label': 'Favorite' }, '★') : null,
      game.state === 'pre' && team.record ? h('span', { class: 'rec' }, team.record) : null),
    showScore ? h('div', { class: 'score' }, team.score) : h('span'),
  );
}

/**
 * One game row. `entry` = { game, rating, pending }.
 * @param {{showLeague?: boolean, onOpen: (game) => void}} opts
 */
export function gameRow(entry, { showLeague = false, onOpen } = {}) {
  const { game, rating, pending } = entry;
  const fav = favoriteFor(game);
  const st = statusInfo(game);
  const w = watchInfo(game);
  const lg = LEAGUE_BY_KEY[game.league];
  const sideBits = [
    showLeague ? h('div', { class: 'league-tag' }, lg.short) : null,
    h('div', { class: `status ${st.cls}` }, st.text),
    w.status !== 'unknown' && game.state !== 'post' ? h('div', { class: `watch${w.status === 'none' ? ' none' : ''}` }, w.short) : null,
  ];
  if (game.sport === 'racing') {
    const podium = game.state === 'post' && game.drivers?.length
      ? game.drivers.slice(0, 3).map((d, i) => `${i + 1}. ${d.short || d.name}`).join('  ')
      : '';
    return h('a', { class: 'game-row', href: `#/game/${game.league}/${encodeURIComponent(game.id)}?e=${game.eventId}`, onclick: onOpen ? (e) => { e.preventDefault(); onOpen(game); } : null },
      game.isRace ? badge(rating, { pending }) : h('span', { class: 'badge none', title: 'Only the race is rated' }, 'F1'),
      h('div', { class: 'teams' },
        h('div', { class: 'race-title' }, `${game.shortName} · ${game.sessionLabel}`),
        h('div', { class: 'race-sub' }, game.circuit),
        podium ? h('div', { class: 'podium' }, podium) : null),
      h('div', { class: 'row-side' }, sideBits));
  }
  return h('a', {
    class: 'game-row',
    href: `#/game/${game.league}/${encodeURIComponent(game.id)}`,
    onclick: onOpen ? (e) => { e.preventDefault(); onOpen(game); } : null,
  },
    fav ? h('span', { class: 'fav-flag', 'aria-hidden': 'true' }) : null,
    badge(rating, { pending }),
    // Soccer lists the home side first (European convention); US sports list away @ home.
    h('div', { class: 'teams' }, game.sport === 'soccer'
      ? [teamLine(game.home, game, game.away, fav), teamLine(game.away, game, game.home, fav)]
      : [teamLine(game.away, game, game.home, fav), teamLine(game.home, game, game.away, fav)]),
    h('div', { class: 'row-side' }, sideBits),
  );
}

export function sectionHeader(title, meta, { live = false } = {}) {
  return h('div', { class: 'section-h' },
    h('h2', null, live ? h('span', { class: 'live-dot', 'aria-hidden': 'true' }) : null, title),
    meta ? h('span', { class: 'meta' }, meta) : null);
}

export function skeletonList(n = 5) {
  return h('div', { class: 'card list', 'aria-busy': 'true' },
    Array.from({ length: n }, () => h('div', { class: 'skel' },
      h('i', { class: 'c' }),
      h('div', null, h('i', { class: 'l', style: { width: '70%' } }), h('i', { class: 'l', style: { width: '55%' } })),
      h('i', { class: 'l' }))));
}

export function backButton(label = 'Back') {
  const b = h('button', { class: 'back', type: 'button' }, icon('back'), label);
  b.addEventListener('click', () => {
    if (history.length > 1) history.back(); else location.hash = '#/';
  });
  return b;
}
