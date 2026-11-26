// ESPN standings JSON -> { season, groups: [{ name, abbr, rows: [{ team, stats, note }] }] }.
// `stats` is keyed by ESPN stat name (first occurrence) and also by `t:<type>`, because college
// standings repeat names per split (overall / home / road / conference) and only `type` is unique.
// Each value is { v: number|null, d: displayValue, a: abbreviation }.

import { parseTeam } from './parse.js';

function statsMap(entry) {
  const map = {};
  for (const s of entry.stats || []) {
    const val = {
      v: typeof s.value === 'number' ? s.value : (s.value != null && s.value !== '' ? +s.value : null),
      d: s.displayValue ?? s.summary ?? '',
      a: s.abbreviation || s.shortDisplayName || '',
    };
    if (s.name && !(s.name in map)) map[s.name] = val;
    if (s.type) map[`t:${s.type}`] = val;
  }
  return map;
}

export function parseStandings(json) {
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
          stats: statsMap(e),
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
