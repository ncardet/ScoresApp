// Where to watch: map a game's broadcasters to the services you have (config/services.js).

import { NETWORKS, ALIASES, SERVICE_SHORT } from '../../config/services.js';

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9+]/g, '');
const aliasMap = new Map(Object.entries(ALIASES).map(([k, v]) => [norm(k), v]));
const netMap = new Map(Object.entries(NETWORKS).map(([k, v]) => [norm(k), { name: k, services: v }]));

export function canonicalNetwork(name) {
  const n = norm(name);
  const alias = aliasMap.get(n);
  if (alias) return alias;
  return netMap.get(n)?.name || String(name || '').trim();
}

/**
 * @param {{name: string, market?: string}[]} broadcasts
 * @param {string[]} myServices services currently enabled
 * @returns {{status: 'ok'|'none'|'unknown', options: {network: string, services: string[], market: string}[], label: string, short: string}}
 */
export function whereToWatch(broadcasts, myServices) {
  const list = (broadcasts || []).filter((b) => b?.name);
  if (!list.length) return { status: 'unknown', options: [], label: '', short: '' };
  const options = [];
  for (const b of list) {
    const network = canonicalNetwork(b.name);
    const entry = netMap.get(norm(network));
    const services = (entry?.services || []).filter((s) => myServices.includes(s));
    if (services.length) options.push({ network, services, market: b.market || 'national' });
  }
  if (!options.length) {
    return {
      status: 'none',
      options: [],
      networks: list.map((b) => b.name),
      label: 'Not on your services',
      short: 'Not on your services',
    };
  }
  // National feeds first; then networks reachable through the most services.
  options.sort((a, b) => (a.market === 'national' ? 0 : 1) - (b.market === 'national' ? 0 : 1) || b.services.length - a.services.length);
  const first = options[0];
  const svc = (s) => SERVICE_SHORT[s] || s;
  const sameName = first.services.length === 1 && norm(first.services[0]) === norm(first.network);
  const label = sameName ? first.network : `${first.network} · ${first.services.join(' / ')}`;
  const short = sameName ? svc(first.network) : `${first.network} · ${first.services.map(svc).join('/')}`;
  return { status: 'ok', options, label, short };
}
