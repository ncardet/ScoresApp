// User settings = config files + on-device overrides (localStorage).
// The config files are the source of truth for the morning brief; the phone can override
// favorites, services and hidden leagues locally from the Settings screen.

import FAVORITES from '../../config/favorites.js';
import { MY_SERVICES } from '../../config/services.js';
import { LEAGUES } from './leagues.js';

const KEY = 'sideline.settings.v1';

// The services config listed before YouTube (free) was added. A phone that saved its service
// toggles back then gets any service added since switched on; one it switched off stays off.
const SERVICES_BEFORE = ['YouTube TV', 'Prime Video', 'Peacock', 'Paramount+', 'HBO Max', 'Netflix'];

function services(saved) {
  if (!Array.isArray(saved.services)) return [...MY_SERVICES];
  const known = new Set(Array.isArray(saved.servicesKnown) ? saved.servicesKnown : SERVICES_BEFORE);
  return MY_SERVICES.filter((s) => saved.services.includes(s) || !known.has(s));
}

function read() {
  try {
    return JSON.parse(globalThis.localStorage?.getItem(KEY) || '{}') || {};
  } catch {
    return {};
  }
}

function write(obj) {
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(obj));
  } catch { /* storage unavailable (private mode): settings last for this session only */ }
}

let cache = null;

export function getSettings() {
  if (cache) return cache;
  const saved = read();
  cache = {
    favorites: Array.isArray(saved.favorites) ? saved.favorites : FAVORITES.map((f) => ({ ...f })),
    services: services(saved),
    hiddenLeagues: Array.isArray(saved.hiddenLeagues) ? saved.hiddenLeagues : [],
    pinFavorites: saved.pinFavorites !== false,
    customized: !!(saved.favorites || saved.services),
  };
  return cache;
}

export function saveSettings(patch) {
  const saved = read();
  const next = { ...saved, ...patch };
  if (patch.services) next.servicesKnown = [...MY_SERVICES];
  write(next);
  cache = null;
  return getSettings();
}

export function resetSettings() {
  write({});
  cache = null;
  return getSettings();
}

export function enabledLeagues() {
  const hidden = new Set(getSettings().hiddenLeagues);
  return LEAGUES.filter((l) => !hidden.has(l.key));
}

/** Team ids that are favorites in a given league. */
export function favoriteTeamIds(leagueKey, favorites = getSettings().favorites) {
  return favorites.filter((f) => f.leagues?.includes(leagueKey)).map((f) => String(f.id));
}

/** The favorite entry a game involves, or null. */
export function favoriteFor(game, favorites = getSettings().favorites) {
  if (!game?.home) return null;
  for (const f of favorites) {
    if (!f.leagues?.includes(game.league)) continue;
    const id = String(f.id);
    if (game.home.id === id || game.away.id === id) return f;
  }
  return null;
}
