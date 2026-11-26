// ESPN standings JSON -> { season, groups: [{ name, abbr, rows: [{ team, stats, note }] }] }.
// `stats` is keyed by ESPN stat name; each value is { v: number|null, d: displayValue, a: abbreviation }.
// College standings repeat stat names per split (conference / overall); the first occurrence
// of a name is the conference split and is stored under `conf:` + name, the second as plain name.

import { parseTeam } from './parse.js';

function statsMap(entry, college) {
  const map = {};
  for (const s of entry.stats || []) {
    const name = s.name || s.type;
    if (!name) continue;
    const val = { v: typeof s.value === 'number' ? s.value : (s.value != null ? +s.value : null), d: s.displayValue ?? s.summary ?? '', a: s.abbreviation || s.shortDisplayName || '' };
    if (college && map[name] && !map[`conf:${name}`]) {
      map[`conf:${name}`] = map[name];
      map[name] = val;
    } else if (!map[name]) {
      map[name] = val;
    }
  }
  return map;
}

export function parseStandings(json, { college = false } = {}) {
  const groups = [];
  const walk = (node, path) => {
    if (!node) return;
    const name = node.name || node.abbreviation || '';
    if (node.standings?.entries?.length) {
      groups.push({
        name,
        abbr: node.abbreviation || '',
        path: [...path, name].filter(Boolean),
        rows: node.standings.entries.map((e) => ({
          team: e.team ? parseTeam({ team: e.team }) : athleteTeam(e),
          stats: statsMap(e, college),
          note: e.note ? { text: e.note.description || '', color: e.note.color || '', rank: e.note.rank } : null,
        })),
      });
    }
    for (const c of node.children || []) walk(c, [...path, node === json ? '' : name]);
  };
  walk(json, []);
  return {
    season: json.seasons?.[0]?.displayName || json.season?.displayName || json.children?.[0]?.standings?.seasonDisplayName || '',
    seasonYear: json.seasons?.[0]?.year || null,
    groups,
  };
}

// F1 driver standings list athletes, not teams.
function athleteTeam(e) {
  const a = e.athlete || {};
  return {
    id: String(a.id ?? ''),
    abbr: a.abbreviation || a.shortName || '',
    name: a.displayName || a.fullName || '',
    short: a.shortName || a.displayName || '',
    logo: a.flag?.href || '',
    color: null,
  };
}
