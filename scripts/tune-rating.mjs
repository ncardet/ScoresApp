#!/usr/bin/env node
// Tune post-game rating weights against the labeled fixtures and the classic/blowout fixtures,
// with calibration rebuilt from the backfilled games (.cache/targets) for every candidate.
// Dev tool: prints the best settings; does not edit config/rating.js.
//
//   node scripts/tune-rating.mjs [--grid]

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import RATING from '../site/config/rating.js';
import { measure, componentsFrom } from '../site/js/rating/index.js';
import { prepareCalibration, rawToRating, normalize, weighted, COMPONENTS } from '../site/js/rating/calibrate.js';
import { SEASONS } from './lib/history.mjs';
import { TARGET_DIR } from './backfill-targets.mjs';
import { loadFixture, FIXTURE_NAMES } from '../test/load-fixture.mjs';

import { loadLabeled } from '../test/load-labeled.mjs';

const BANDS = {
  G: (v) => v >= 85, G95: (v) => v >= 85, GOOD: (v) => v >= 65 && v < 85, D: (v) => v < 40,
  DOK: (v) => v < 65, OK: (v) => v >= 40 && v < 65, OKMAX: (v) => v <= 64,
  great: (v) => v >= 85, dull: (v) => v < 40,
};

async function targetBases(league) {
  const out = [];
  for (const s of SEASONS[league]?.eval || []) {
    try {
      const c = JSON.parse(await readFile(join(TARGET_DIR, league, `${s}.json`), 'utf8'));
      for (const v of Object.values(c)) if (v.b) out.push(v.b);
    } catch { /* none */ }
  }
  return out;
}

export async function evaluate(fixtures, basesByLeague) {
  const cals = {};
  for (const [league, bases] of Object.entries(basesByLeague)) {
    const rows = bases.map((b) => { const r = componentsFrom(b); return COMPONENTS.map((c) => r[c]); });
    cals[league] = prepareCalibration({ columns: COMPONENTS, rows }, league);
  }
  const results = [];
  for (const f of fixtures) {
    const cal = cals[f.league];
    if (!cal) continue;
    const v = Math.round(rawToRating(weighted(normalize(componentsFrom(f.base), cal.scales), RATING.weights), cal));
    results.push({ ...f, value: v, ok: BANDS[f.band](v) });
  }
  return results;
}

async function main() {
  const fixtures = [];
  const labeled = loadLabeled ? await loadLabeled() : [];
  for (const { fx, detail } of labeled) {
    if (fx.league === 'f1') continue;
    fixtures.push({ slug: fx.slug, league: fx.league, band: fx.band, base: measure(detail).base, kind: 'labeled' });
  }
  for (const name of FIXTURE_NAMES) {
    const { fx, detail } = await loadFixture(name);
    if (fx.league === 'f1') continue;
    fixtures.push({ slug: name, league: fx.league, band: fx.expect, base: measure(detail).base, kind: 'classic' });
  }
  const leagues = [...new Set(fixtures.map((f) => f.league))];
  const bases = {};
  for (const l of leagues) bases[l] = await targetBases(l);
  const report = async (label) => {
    const r = await evaluate(fixtures, bases);
    const lab = r.filter((x) => x.kind === 'labeled');
    const cls = r.filter((x) => x.kind === 'classic');
    const lowGreat = lab.filter((x) => /^G9?5?$/.test(x.band) && x.value < 75);
    return { label, hit: lab.filter((x) => x.ok).length / lab.length, classic: cls.filter((x) => x.ok).length, nClassic: cls.length, lowGreat: lowGreat.length, misses: [...lab, ...cls].filter((x) => !x.ok).map((x) => `${x.slug}[${x.band}]=${x.value}`) };
  };
  console.log('current:', JSON.stringify(await report('current')));
  if (!process.argv.includes('--grid')) return;
  const base = JSON.parse(JSON.stringify(RATING.weights));
  const baseLate = RATING.comebackLateness;
  let best = null;
  for (const stakes of [0.1, 0.16, 0.22]) {
    for (const quality of [0.04, 0.08, 0.12]) {
      for (const late of [0.5, 0.8]) {
        for (const novelty of [0.12, 0.16]) {
          RATING.weights = { ...base, stakes, quality, novelty };
          RATING.comebackLateness = late;
          const r = await report(`stakes ${stakes} quality ${quality} late ${late} novelty ${novelty}`);
          const score = r.hit * 100 + r.classic * 2 - r.lowGreat * 10;
          if (!best || score > best.score) best = { ...r, score };
        }
      }
    }
  }
  RATING.weights = base;
  RATING.comebackLateness = baseLate;
  console.log('best:', JSON.stringify(best, null, 1));
}

main();
