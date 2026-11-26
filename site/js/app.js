// App entry: hash router, tab bar, service worker.
//   #/                      Today
//   #/day/2026-11-26        another day
//   #/game/<league>/<id>    game page (F1 sessions add ?e=<eventId>)
//   #/standings[/<league>]  standings & brackets
//   #/settings

import { h, clear, icon } from './ui/dom.js';
import { homeView } from './ui/home.js';
import { gameView } from './ui/game.js';
import { standingsView } from './ui/standings.js';
import { settingsView } from './ui/settings.js';
import { closeSheet } from './ui/components.js';
import { prunePersisted } from './adapters/espn/client.js';

const root = document.getElementById('app');
let cleanup = null;
const scrollMemory = new Map();
let currentHash = null;

function parse(hash) {
  const [path, query = ''] = (hash || '#/').replace(/^#/, '').split('?');
  const parts = path.split('/').filter(Boolean).map(decodeURIComponent);
  const q = Object.fromEntries(new URLSearchParams(query));
  if (!parts.length) return { name: 'home', params: {} };
  if (parts[0] === 'day') return { name: 'home', params: { date: parts[1] } };
  if (parts[0] === 'game') return { name: 'game', params: { league: parts[1], id: parts[2], ...q } };
  if (parts[0] === 'standings') return { name: 'standings', params: { league: parts[1] } };
  if (parts[0] === 'settings') return { name: 'settings', params: {} };
  return { name: 'home', params: {} };
}

const VIEWS = { home: homeView, game: gameView, standings: standingsView, settings: settingsView };

function tabbar(active) {
  const tab = (name, href, label, ic) => h('a', { class: 'tab', href, 'aria-current': active === name ? 'page' : null }, icon(ic), label);
  return h('nav', { class: 'tabbar', 'aria-label': 'Main' },
    tab('home', '#/', 'Today', 'today'),
    tab('standings', '#/standings', 'Standings', 'standings'),
    tab('settings', '#/settings', 'Settings', 'settings'));
}

function route() {
  if (currentHash != null) scrollMemory.set(currentHash, window.scrollY);
  closeSheet();
  if (cleanup) { try { cleanup(); } catch { /* ignore */ } }
  const { name, params } = parse(location.hash);
  currentHash = location.hash || '#/';
  const container = h('main');
  clear(root).append(container, tabbar(name === 'game' ? 'home' : name));
  cleanup = VIEWS[name](container, params) || null;
  const y = scrollMemory.get(currentHash);
  requestAnimationFrame(() => window.scrollTo(0, y || 0));
}

window.addEventListener('hashchange', route);
route();

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch((e) => console.warn('SW registration failed', e));
  });
}

// Housekeeping: keep the offline cache bounded.
setTimeout(() => prunePersisted().catch(() => {}), 15000);
