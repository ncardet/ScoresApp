// League structure (team -> conference / division) from ESPN standings, cached on disk.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getJson } from '../../site/js/adapters/espn/client.js';
import { LEAGUE_BY_KEY } from '../../site/js/core/leagues.js';
import { CACHE_DIR } from './history.mjs';

const V2 = 'https://site.api.espn.com/apis/v2/sports';

/** Map teamId -> { conf, div } (names). Single-table leagues get conf = 'all'. */
export async function leagueStructure(league, { maxAgeHours = 72 } = {}) {
  const file = join(CACHE_DIR, '..', 'structure', `${league}.json`);
  try {
    const raw = JSON.parse(await readFile(file, 'utf8'));
    if (Date.now() - raw.at < maxAgeHours * 3600e3) return new Map(Object.entries(raw.map));
  } catch { /* miss */ }
  const lg = LEAGUE_BY_KEY[league];
  const map = {};
  try {
    const res = await getJson(`${V2}/${lg.espn}/standings?level=3`, { retries: 2 });
    const walk = (node, conf) => {
      const name = node.name || node.abbreviation || '';
      for (const e of node.standings?.entries || []) {
        const id = String(e.team?.id ?? '');
        if (!id) continue;
        map[id] = { conf: conf || name, div: conf ? name : name };
      }
      for (const c of node.children || []) walk(c, node === res.json ? null : (conf || name));
    };
    walk(res.json, null);
  } catch { /* fall back to empty structure */ }
  await mkdir(join(CACHE_DIR, '..', 'structure'), { recursive: true });
  await writeFile(file, JSON.stringify({ at: Date.now(), map }));
  return new Map(Object.entries(map));
}
