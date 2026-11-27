// Settings: favorites, services, leagues, data status, morning brief link.
// Changes are stored on this device. config/favorites.js and config/services.js stay the
// source of truth for the morning brief; "Copy as config" helps you update them.

import { h, clear, fill, logo } from './dom.js';
import { getSettings, saveSettings, resetSettings } from '../core/settings.js';
import { MY_SERVICES } from '../../config/services.js';
import { appHeader } from './components.js';
import { LEAGUES, LEAGUE_BY_KEY } from '../core/leagues.js';
import { ADAPTERS } from '../adapters/index.js';
import { lastUpdate, clearCaches } from '../app/store.js';
import { sourceStatus } from '../adapters/espn/client.js';
import { formatStamp } from '../core/time.js';
import { getCalibration, ENGINE_VERSION } from '../rating/index.js';

const ALL_SERVICES = [...new Set([...MY_SERVICES, 'YouTube TV', 'Prime Video', 'Peacock', 'Paramount+', 'HBO Max', 'Netflix'])];

function row(...children) {
  return h('div', { class: 'set-row' }, ...children);
}

function toggle(checked, onchange, label) {
  return h('input', { type: 'checkbox', class: 'toggle', checked, 'aria-label': label, onchange: (e) => onchange(e.target.checked) });
}

export function settingsView(root) {
  const body = h('div');
  fill(root, h('div', { class: 'view' },
    appHeader({ title: 'Settings' }),
    body));
  let picker = null;

  function draw() {
    const st = getSettings();
    const parts = [];

    // Favorites
    parts.push(h('div', { class: 'section-h' }, h('h2', null, 'Favorites'), h('span', { class: 'meta' }, 'pinned on Today, starred')));
    parts.push(h('div', { class: 'card list' },
      st.favorites.length ? st.favorites.map((f, i) => row(
        h('div', { class: 'grow' }, h('div', null, f.name), h('div', { class: 'sub' }, f.leagues.map((k) => LEAGUE_BY_KEY[k]?.short || k).join(' · '))),
        h('button', { class: 'btn danger', type: 'button', onclick: () => { const fav = [...st.favorites]; fav.splice(i, 1); saveSettings({ favorites: fav }); draw(); } }, 'Remove'),
      )) : row(h('div', { class: 'grow muted' }, 'No favorites yet.')),
      row(h('div', { class: 'grow' }, 'Add a team'), h('button', { class: 'btn primary', type: 'button', onclick: () => openPicker() }, 'Add'))));
    if (picker) parts.push(picker);

    // Services
    parts.push(h('div', { class: 'section-h' }, h('h2', null, 'My services'), h('span', { class: 'meta' }, 'for where to watch')));
    parts.push(h('div', { class: 'card list' }, ALL_SERVICES.map((svc) => row(
      h('div', { class: 'grow' }, svc),
      toggle(st.services.includes(svc), (on) => {
        const set = new Set(getSettings().services);
        if (on) set.add(svc); else set.delete(svc);
        saveSettings({ services: ALL_SERVICES.filter((x) => set.has(x)) });
      }, svc)))));
    parts.push(h('p', { class: 'tiny', style: { margin: '6px 4px' } }, 'Which networks each service carries lives in config/services.js.'));

    // Leagues
    parts.push(h('div', { class: 'section-h' }, h('h2', null, 'Leagues')));
    parts.push(h('div', { class: 'card list' }, LEAGUES.map((l) => row(
      h('div', { class: 'grow' }, l.name),
      toggle(!st.hiddenLeagues.includes(l.key), (on) => {
        const hidden = new Set(getSettings().hiddenLeagues);
        if (on) hidden.delete(l.key); else hidden.add(l.key);
        saveSettings({ hiddenLeagues: [...hidden] });
      }, l.name)))));

    // Home
    parts.push(h('div', { class: 'section-h' }, h('h2', null, 'Today screen')));
    parts.push(h('div', { class: 'card list' }, row(
      h('div', { class: 'grow' }, h('div', null, 'Pin favorites to the top'), h('div', { class: 'sub' }, 'Off: favorites get a ranking boost instead')),
      toggle(st.pinFavorites, (on) => saveSettings({ pinFavorites: on }), 'Pin favorites'))));

    // Data
    const upd = lastUpdate();
    const src = sourceStatus();
    const calRows = h('div', { class: 'tiny', style: { padding: '0 16px 12px' } }, 'Loading calibration…');
    parts.push(h('div', { class: 'section-h' }, h('h2', null, 'Data')));
    parts.push(h('div', { class: 'card list' },
      row(h('div', { class: 'grow' }, 'Last data update'), h('div', { class: 'muted' }, upd ? formatStamp(upd) : '—')),
      src.lastError && src.lastErrorAt > (src.lastOk || 0) ? row(h('div', { class: 'grow' }, 'Last error'), h('div', { class: 'muted' }, `${formatStamp(src.lastErrorAt)}`)) : null,
      row(h('div', { class: 'grow' }, h('div', null, 'Morning brief feed'), h('div', { class: 'sub' }, 'Published daily by a GitHub Action')),
        h('a', { class: 'btn', href: 'data/brief.json', target: '_blank', rel: 'noopener' }, 'brief.json'),
        h('a', { class: 'btn', href: 'data/brief.md', target: '_blank', rel: 'noopener' }, '.md')),
      row(h('div', { class: 'grow' }, 'Rating engine'), h('div', { class: 'muted' }, `v${ENGINE_VERSION}`)),
      row(h('div', { class: 'grow' }, h('div', null, 'Weather data by Open-Meteo.com'), h('div', { class: 'sub' }, 'Used for F1 rain chances (CC BY 4.0)')),
        h('a', { class: 'btn', href: 'https://open-meteo.com/', target: '_blank', rel: 'noopener' }, 'Open-Meteo')),
      calRows,
      row(h('div', { class: 'grow' }, 'Clear cached games and ratings'), h('button', { class: 'btn danger', type: 'button', onclick: async (e) => { e.target.textContent = 'Clearing…'; await clearCaches(); e.target.textContent = 'Cleared'; } }, 'Clear')),
      row(h('div', { class: 'grow' }, h('div', null, 'Copy favorites as config'), h('div', { class: 'sub' }, 'Paste into config/favorites.js so the brief matches')),
        h('button', { class: 'btn', type: 'button', onclick: (e) => copyConfig(e.target) }, 'Copy')),
      row(h('div', { class: 'grow' }, 'Reset to config defaults'), h('button', { class: 'btn danger', type: 'button', onclick: () => { resetSettings(); draw(); } }, 'Reset'))));
    fill(body, parts);

    Promise.all(LEAGUES.map(async (l) => [l.short, (await getCalibration(l.key)).n])).then((list) => {
      calRows.textContent = `Calibrated on ${list.map(([k, n]) => `${k} ${n}`).join(' · ')} past games.`;
    });
  }

  function copyConfig(btn) {
    const fav = getSettings().favorites;
    const text = `export default [\n${fav.map((f) => `  { name: ${JSON.stringify(f.name)}, leagues: ${JSON.stringify(f.leagues)}, id: ${JSON.stringify(String(f.id))} },`).join('\n')}\n];\n`;
    navigator.clipboard?.writeText(text).then(() => { btn.textContent = 'Copied'; }, () => { btn.textContent = 'Copy failed'; });
  }

  function openPicker() {
    const select = h('select', { class: 'input', 'aria-label': 'League' },
      h('option', { value: '' }, 'Choose a league…'),
      LEAGUES.filter((l) => l.key !== 'f1').map((l) => h('option', { value: l.key }, l.name)));
    const search = h('input', { type: 'search', placeholder: 'Search teams', 'aria-label': 'Search teams' });
    const results = h('div', { class: 'list' });
    let teams = [];
    const show = () => {
      const q = search.value.trim().toLowerCase();
      const list = teams.filter((t) => !q || t.name.toLowerCase().includes(q) || t.abbr.toLowerCase() === q).slice(0, 40);
      fill(results, list.map((t) => h('button', {
        class: 'team-pick', type: 'button',
        onclick: () => {
          const key = select.value;
          const fav = [...getSettings().favorites];
          const existing = fav.find((f) => String(f.id) === t.id && f.leagues.some((k) => LEAGUE_BY_KEY[k]?.sport === LEAGUE_BY_KEY[key]?.sport));
          if (existing) { if (!existing.leagues.includes(key)) existing.leagues.push(key); } else fav.push({ name: t.name, leagues: [key], id: t.id });
          saveSettings({ favorites: fav });
          picker = null;
          draw();
        },
      }, logo(t.logo, ''), h('span', null, t.name), h('span', { class: 'tiny' }, t.abbr))));
    };
    select.addEventListener('change', async () => {
      fill(results, h('div', { class: 'set-row muted' }, 'Loading teams…'));
      try { teams = await ADAPTERS[select.value].teams(); } catch { teams = []; }
      show();
    });
    search.addEventListener('input', show);
    picker = h('div', { class: 'card', style: { marginTop: '10px', padding: '12px 0' } },
      h('div', { style: { padding: '0 16px', display: 'grid', gap: '8px' } }, select, search),
      results,
      h('button', { class: 'more-btn', type: 'button', onclick: () => { picker = null; draw(); } }, 'Cancel'));
    draw();
  }

  draw();
  return () => {};
}
