// Where to watch: map a game's broadcasters to the services you have (config/services.js).

import { NETWORKS, ALIASES, SERVICE_SHORT, FREE_YOUTUBE, PREFERENCE, LEAGUE_NETWORKS, LEAGUE_CARRIERS, KNOWN_GAPS } from '../../config/services.js';

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9+]/g, '');

// Compact network names for the game rows (display only).
const NETWORK_SHORT = {
  'CBS Sports Network': 'CBSSN', 'Big Ten Network': 'BTN', 'USA Network': 'USA', 'ESPN Deportes': 'ESPN Dep',
  'Golf Channel': 'Golf', 'NFL Network': 'NFLN', 'NFL RedZone': 'RedZone', 'MLB Network': 'MLBN', 'NHL Network': 'NHLN',
  'SEC Network': 'SECN', 'ACC Network': 'ACCN', 'CBS Sports Golazo Network': 'Golazo', 'FOX Deportes': 'FOX Dep',
};
const aliasMap = new Map(Object.entries(ALIASES).map(([k, v]) => [norm(k), v]));
const netMap = new Map(Object.entries(NETWORKS).map(([k, v]) => [norm(k), { name: k, services: v }]));

// A free YouTube stream under a name not listed yet ("WNBA on YouTube"), but never YouTube TV.
const YOUTUBE_LIKE = /you\s*tube/i;
const YOUTUBE_TV = /you\s*tube\s*tv|\byttv\b/i;

export const FREE_LABEL = 'Free on YouTube';
export const LOCAL_LABEL = 'Not on your services (local TV)';

export function canonicalNetwork(name) {
  const n = norm(name);
  const alias = aliasMap.get(n);
  if (alias) return alias;
  return netMap.get(n)?.name || String(name || '').trim();
}

/** Services that carry a network in this league, or null when the network isn't in the map. */
function carriers(network, league) {
  const base = netMap.get(norm(network))?.services;
  const extra = LEAGUE_NETWORKS[league]?.[network];
  if (!base && !extra) return null;
  return [...new Set([...(base || []), ...(extra || [])])];
}

/** Broadcaster names that aren't in config/services.js (the brief logs them for review). */
export function unmappedNetworks(broadcasts) {
  return [...new Set((broadcasts || []).map((b) => b?.name).filter((n) => n && !carriers(canonicalNetwork(n), '')))];
}

/**
 * @param {{name: string, market?: string}[]} broadcasts
 * @param {string[]} myServices services currently enabled
 * @param {string} [league] league key, for league-specific carriage and preference
 * @returns {{status: 'ok'|'none'|'unknown', options: {network: string, services: string[], market: string}[], label: string, short: string, free?: boolean}}
 */
export function whereToWatch(broadcasts, myServices, league = '') {
  const list = (broadcasts || []).filter((b) => b?.name);
  if (!list.length) return { status: 'unknown', options: [], label: '', short: '' };
  const options = [];
  for (const b of list) {
    let network = canonicalNetwork(b.name);
    let services = carriers(network, league);
    if (!services && YOUTUBE_LIKE.test(b.name) && !YOUTUBE_TV.test(b.name)) {
      network = 'YouTube';
      services = carriers(network, league);
    }
    const mine = (services || []).filter((s) => myServices.includes(s));
    if (mine.length) options.push({ network, services: mine, market: b.market || 'national' });
  }
  if (!options.length) {
    // Every listed broadcaster is a local channel (home or away market): say so.
    const local = list.every((b) => b.market && b.market !== 'national');
    const label = local ? LOCAL_LABEL : 'Not on your services';
    return { status: 'none', options: [], networks: list.map((b) => b.name), label, short: label };
  }
  // Preferred services first (a free YouTube stream; per-league overrides), then national feeds,
  // then networks reachable through the most services.
  const prefer = PREFERENCE[league] || PREFERENCE.default;
  const rank = (o) => {
    const i = prefer.findIndex((p) => o.services.includes(p));
    return i < 0 ? prefer.length : i;
  };
  const local = (o) => (o.market === 'national' ? 0 : 1);
  options.sort((a, b) => rank(a) - rank(b) || local(a) - local(b) || b.services.length - a.services.length);
  const first = options[0];
  if (first.services.includes(FREE_YOUTUBE)) return { status: 'ok', options, label: FREE_LABEL, short: FREE_LABEL, free: true };
  const svc = (s) => SERVICE_SHORT[s] || s;
  const sameName = first.services.length === 1 && norm(first.services[0]) === norm(first.network);
  const label = sameName ? first.network : `${first.network} · ${first.services.join(' / ')}`;
  const net = NETWORK_SHORT[first.network] || first.network;
  const short = sameName ? svc(first.network) : `${net} · ${first.services.map(svc).join('/')}`;
  return { status: 'ok', options, label, short };
}

/**
 * Settings → What my services cover, for one league: which of your services carry its usual
 * networks, and what's missing (networks none of them carry, plus the known gaps in the config).
 * @returns {{on: string[], missing: string[]}}
 */
export function coverage(league, myServices) {
  const on = new Set();
  const missing = [];
  for (const network of LEAGUE_CARRIERS[league] || []) {
    const mine = (carriers(network, league) || []).filter((s) => myServices.includes(s));
    if (mine.length) mine.forEach((s) => on.add(s));
    else missing.push(network);
  }
  const order = [FREE_YOUTUBE, ...myServices];
  const gaps = KNOWN_GAPS[league] || [];
  const noted = (n) => gaps.some((g) => g.toLowerCase().includes(n.toLowerCase()));
  return {
    on: [...on].sort((a, b) => order.indexOf(a) - order.indexOf(b)),
    missing: [...gaps, ...missing.filter((n) => !noted(n))],
  };
}
