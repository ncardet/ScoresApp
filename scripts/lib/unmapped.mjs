// Broadcaster names that config/services.js doesn't map, collected by the morning brief into
// site/data/unmapped-networks.json, so a new local channel or YouTube channel gets noticed and
// can be mapped (or confirmed as not on your services).

import { unmappedNetworks } from '../../site/js/core/watch.js';

const YOUTUBE_LIKE = /you\s*tube/i;
const YOUTUBE_TV = /you\s*tube\s*tv|\byttv\b/i;

/**
 * Merge one run's games into the log. Counts are distinct days a name was seen.
 * @param {object|null} prev the previous file (or null)
 * @param {{league: string, broadcasts?: {name: string, market?: string}[]}[]} games
 * @param {string} day YYYY-MM-DD (Pacific)
 */
export function mergeUnmapped(prev, games, day) {
  const names = structuredClone(prev?.names || {});
  const seenToday = new Set();
  for (const g of games) {
    const missing = new Set(unmappedNetworks(g.broadcasts));
    for (const b of g.broadcasts || []) {
      if (!b?.name || !missing.has(b.name)) continue;
      const e = names[b.name] || { days: 0, firstSeen: day, lastSeen: day, leagues: [], markets: [] };
      if (!seenToday.has(b.name) && e.lastSeen !== day) e.days += 1;
      if (!e.days) e.days = 1;
      seenToday.add(b.name);
      e.lastSeen = day > e.lastSeen ? day : e.lastSeen;
      if (!e.leagues.includes(g.league)) e.leagues.push(g.league);
      const market = b.market || 'national';
      if (!e.markets.includes(market)) e.markets.push(market);
      if (YOUTUBE_LIKE.test(b.name) && !YOUTUBE_TV.test(b.name)) e.youtubeLike = true;
      names[b.name] = e;
    }
  }
  const sorted = Object.fromEntries(Object.entries(names).sort((a, b) => b[1].days - a[1].days || a[0].localeCompare(b[0])));
  return {
    updated: day,
    note: 'Broadcasters ESPN listed that config/services.js does not map. Local channels show as "Not on your services (local TV)"; youtubeLike names are treated as free YouTube until mapped.',
    names: sorted,
  };
}
