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
import { calibrationFile } from './lib/calibration.mjs';
import { loadFixture, FIXTURE_NAMES } from '../test/load-fixture.mjs';

import { loadLabeled } from '../test/load-labeled.mjs';

const BANDS = {
  G: (v) => v >= 85, G95: (v) => v >= 85, GOOD: (v) => v >= 65 && v < 85, D: (v) => v < 40,
  DOK: (v) => v < 65, OK: (v) => v >= 40 && v < 65, OKMAX: (v) => v <= 64,
  great: (v) => v >= 85, dull: (v) => v < 40,
};

// Signed distance into the target band (negative = outside), for a robustness bonus.
const MARGIN = {
  G: (v) => v - 85, G95: (v) => v - 85, great: (v) => v - 85, GOOD: (v) => Math.min(v - 65, 84.5 - v),
  D: (v) => 39.5 - v, dull: (v) => 39.5 - v, DOK: (v) => 64.5 - v, OK: (v) => Math.min(v - 40, 64.5 - v), OKMAX: (v) => 64.5 - v,
};

async function targetBases(league) {
  const out = [];
  for (const s of SEASONS[league]?.eval || []) {
    try {
      const c = JSON.parse(await readFile(join(TARGET_DIR, league, `${s}.json`), 'utf8'));
      for (const v of Object.values(c)) if (v.b || v.raw) out.push(v);
    } catch { /* none */ }
  }
  return out;
}

export async function evaluate(fixtures, entriesByLeague) {
  const cals = {};
  // The same rows the backtest writes to site/data/calibration (deterministic sample).
  for (const [league, entries] of Object.entries(entriesByLeague)) cals[league] = prepareCalibration(calibrationFile(league, entries), league);
  const results = [];
  for (const f of fixtures) {
    const cal = cals[f.league];
    if (!cal) continue;
    const v = Math.round(rawToRating(weighted(normalize(componentsFrom(f.base), cal.scales), RATING.weights, RATING.amplifiers), cal));
    results.push({ ...f, value: v, ok: BANDS[f.band](v), margin: MARGIN[f.band] ? MARGIN[f.band](v) : 0 });
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
    const margin = [...lab, ...cls].reduce((t, x) => t + Math.max(-15, Math.min(6, x.margin)), 0) / (lab.length + cls.length);
    return { label, hit: lab.filter((x) => x.ok).length / lab.length, classic: cls.filter((x) => x.ok).length, nClassic: cls.length, lowGreat: lowGreat.length, margin, misses: [...lab, ...cls].filter((x) => !x.ok).map((x) => `${x.slug}[${x.band}]=${x.value}`) };
  };
  if (process.argv.includes('--f1')) return tuneF1(labeled);
  console.log('current:', JSON.stringify(await report('current')));
  if (process.argv.includes('--search')) return search(report);
  if (!process.argv.includes('--grid')) return;
  const base = JSON.parse(JSON.stringify(RATING.weights));
  const baseLate = RATING.comebackLateness;
  let best = null;
  for (const stakes of [0.16, 0.22, 0.28]) {
    for (const quality of [0.08, 0.12, 0.16]) {
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

// ---------- random search + local refinement (seeded, reproducible) ----------

const SPACE = {
  swing: [0.16, 0.36], closeness: [0.06, 0.26], leadChanges: [0.04, 0.16], comeback: [0.08, 0.28],
  novelty: [0.08, 0.22], pace: [0.02, 0.06], stakes: [0.08, 0.32], quality: [0.04, 0.22],
  comebackLateness: [0.4, 0.9], swingLateBoost: [0, 8], soccerCloseTrust: [0.35, 0.9],
  stakesAmp: [0, 0.8], qualityAmp: [0, 0.4], lateSwingCredit: [0, 1], compLate: [0, 1],
};
const WEIGHT_KEYS = ['swing', 'closeness', 'leadChanges', 'comeback', 'novelty', 'pace', 'stakes', 'quality'];

function rng(seed) {
  let x = seed >>> 0;
  return () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; };
}

function apply(p) {
  RATING.weights = Object.fromEntries(WEIGHT_KEYS.map((k) => [k, p[k]]));
  RATING.comebackLateness = p.comebackLateness;
  RATING.swingLateBoost = p.swingLateBoost;
  RATING.soccerCloseTrust = p.soccerCloseTrust;
  RATING.amplifiers = { stakes: p.stakesAmp, qualityC: p.qualityAmp };
  RATING.lateSwingCredit = p.lateSwingCredit;
  RATING.compLate = p.compLate >= 0.5;
}

const round = (p) => Object.fromEntries(Object.entries(p).map(([k, v]) => [k, Math.round(v * 100) / 100]));


async function search(report) {
  const n = +(process.argv[process.argv.indexOf('--search') + 1]) || 400;
  const rand = rng(20261127);
  const current = { ...RATING.weights, comebackLateness: RATING.comebackLateness, swingLateBoost: RATING.swingLateBoost, soccerCloseTrust: RATING.soccerCloseTrust ?? 0.6, stakesAmp: RATING.amplifiers?.stakes ?? 0, qualityAmp: RATING.amplifiers?.qualityC ?? 0, lateSwingCredit: RATING.lateSwingCredit ?? 0, compLate: RATING.compLate ? 1 : 0 };
  // Score: labeled hit rate, classic fixtures, no Great below 75; small pull toward the current
  // settings so ties go to the smaller change.
  const dist = (p) => Object.keys(SPACE).reduce((s, k) => s + Math.abs(p[k] - current[k]) / (SPACE[k][1] - SPACE[k][0]), 0);
  // Margin: mean signed distance into each fixture's band (capped), so borderline passes count less.
  const score = (r, p) => r.hit * 100 + r.classic * 2 - r.lowGreat * 10 + r.margin * 0.6 - dist(p) * 0.5;
  // Evaluate the rounded settings, exactly as they would be written to config/rating.js.
  const evalP = async (p0) => { const p = round(p0); apply(p); const r = await report(''); return { p, r, s: score(r, p) }; };
  let best = await evalP(current);
  for (let i = 0; i < n; i++) {
    const p = Object.fromEntries(Object.entries(SPACE).map(([k, [lo, hi]]) => [k, lo + rand() * (hi - lo)]));
    const e = await evalP(p);
    if (e.s > best.s) best = e;
  }
  for (let i = 0; i < n; i++) {
    const p = { ...best.p };
    for (const k of Object.keys(SPACE)) {
      if (rand() < 0.35) {
        const [lo, hi] = SPACE[k];
        p[k] = Math.min(hi, Math.max(lo, p[k] + (rand() - 0.5) * 0.25 * (hi - lo)));
      }
    }
    const e = await evalP(p);
    if (e.s > best.s) best = e;
  }
  apply(current);
  console.log('best:', JSON.stringify({ params: best.p, score: Math.round(best.s * 10) / 10, hit: best.r.hit, classic: `${best.r.classic}/${best.r.nClassic}`, lowGreat: best.r.lowGreat, margin: Math.round(best.r.margin * 10) / 10, misses: best.r.misses }, null, 1));
}

// ---------- F1: weights for the race rating, on the labeled races ----------

async function tuneF1(labeled) {
  const { measureF1 } = await import('../site/js/rating/f1.js');
  const { raceControlSummary } = await import('../site/js/adapters/f1.js');
  const { normalizeF1, F1_COMPONENTS } = await import('../site/js/rating/calibrate.js');
  const cache = JSON.parse(await readFile(join(TARGET_DIR, 'f1', 'races.json'), 'utf8'));
  const rows = Object.entries(cache).filter(([k, r]) => k !== '_standings' && r.input).map(([, r]) => {
    const m = measureF1({ f1: { laps: r.input.laps, control: raceControlSummary(r.input.rc), classification: r.input.classification, standings: cache._standings?.[r.year] || null, raceIndex: r.raceIndex } });
    return F1_COMPONENTS.map((c) => m.raw[c]);
  });
  const fixtures = labeled.filter(({ fx }) => fx.league === 'f1').map(({ fx, detail }) => ({ slug: fx.slug, band: fx.band, raw: measureF1(detail).raw }));
  console.log(`F1: ${rows.length} re-measured races, ${fixtures.length} labeled`);
  const evalW = (w) => {
    RATING.f1.weights = w;
    const cal = prepareCalibration({ columns: F1_COMPONENTS, rows }, 'f1');
    return fixtures.map((f) => {
      const v = Math.round(rawToRating(weighted(normalizeF1(f.raw, cal.scales), w), cal));
      return { slug: f.slug, band: f.band, v, ok: BANDS[f.band](v), margin: MARGIN[f.band] ? MARGIN[f.band](v) : 0 };
    });
  };
  const current = { ...RATING.f1.weights };
  const show = (label, r) => console.log(label, r.filter((x) => x.ok).length + '/' + r.length, r.map((x) => `${x.slug}[${x.band}]=${x.v}${x.ok ? '' : ' MISS'}`).join(' · '));
  show('current', evalW(current));
  const keys = Object.keys(current);
  const rand = rng(91);
  const score = (r, w) => r.filter((x) => x.ok).length * 10 + r.reduce((t, x) => t + Math.max(-15, Math.min(6, x.margin)), 0) / r.length * 0.6
    - keys.reduce((t, k) => t + Math.abs(w[k] - current[k]), 0) * 2;
  let best = { w: current, r: evalW(current) };
  best.s = score(best.r, best.w);
  for (let i = 0; i < 3000; i++) {
    const w = Object.fromEntries(keys.map((k) => [k, Math.round((i < 1500 ? 0.04 + rand() * 0.32 : Math.min(0.4, Math.max(0.02, best.w[k] + (rand() - 0.5) * 0.08))) * 100) / 100]));
    const r = evalW(w);
    const sc = score(r, w);
    if (sc > best.s) best = { w, r, s: sc };
  }
  RATING.f1.weights = current;
  show('best', best.r);
  console.log('weights:', JSON.stringify(best.w));
}

main();
