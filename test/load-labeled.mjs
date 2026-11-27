// Load the labeled sanity fixtures (test/fixtures/labeled/*.json.gz) as GameDetails.
import { readFile, readdir } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { parseEvent } from '../site/js/adapters/espn/parse.js';
import { parseSummary } from '../site/js/adapters/espn/summary.js';

const DIR = new URL('./fixtures/labeled/', import.meta.url);

export async function loadLabeled() {
  let files = [];
  try { files = (await readdir(DIR)).filter((f) => f.endsWith('.json.gz')); } catch { return []; }
  const out = [];
  for (const f of files.sort()) {
    const fx = JSON.parse(gunzipSync(await readFile(new URL(f, DIR))).toString('utf8'));
    let detail;
    let game;
    if (fx.league === 'f1') {
      const r = fx.f1.race;
      game = { key: `f1:${fx.slug}`, id: fx.slug, league: 'f1', sport: 'racing', isRace: true, state: 'post', completed: true, start: r.start, circuit: `${r.circuit} ${r.location}`, gpName: r.location, notes: [], seasonType: 2, drivers: [] };
      detail = { key: game.key, league: 'f1', sport: 'racing', game, plays: [], wp: null, f1: { ...fx.f1 } };
    } else {
      game = parseEvent(fx.event, fx.league);
      detail = parseSummary(fx.summary, fx.league, game);
    }
    out.push({ fx, game, detail });
  }
  return out;
}
