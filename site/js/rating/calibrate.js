// Calibration: raw scores -> 0..100 by percentile within each league.
//
// site/data/calibration/<league>.json holds RAW component values for a sample of past games
// (written by scripts/backfill.mjs). On load we compute:
//   scales  95th percentile of swing / lead changes / pace (normalises those components)
//   finals  sorted raw scores of past games under the CURRENT weights
//   prior   sorted pre-game prior scores
// so editing weights in config/rating.js never needs a new backfill.

import RATING from '../../config/rating.js';
import { normCdf } from './wp.js';

export const COMPONENTS = ['swing', 'closeness', 'leadChanges', 'comeback', 'novelty', 'pace', 'stakes', 'quality'];
export const F1_COMPONENTS = ['leadChanges', 'overtakes', 'finalGap', 'incidents', 'stakes'];
const SCALED = ['swing', 'leadChanges', 'pace'];
const F1_SCALED = ['leadChanges', 'overtakes'];

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const asc = (a, b) => a - b;

export function quantile(sorted, q) {
  if (!sorted.length) return null;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/** Mid-rank percentile of x within sorted values, interpolated, in [0, 1]. */
export function percentile(sorted, x) {
  const n = sorted.length;
  if (!n) return 0.5;
  if (x < sorted[0]) return 0; // duller than every sampled game
  if (x > sorted[n - 1]) return 1; // better than every sampled game
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] <= x) lo = mid; else hi = mid;
  }
  const frac = sorted[hi] > sorted[lo] ? (x - sorted[lo]) / (sorted[hi] - sorted[lo]) : 0;
  return (lo + 0.5 + frac) / n;
}

/** Piecewise-linear percentile -> rating map (config `curve`). */
export function curveValue(p, curve = RATING.curve) {
  const x = clamp01(p);
  for (let i = 1; i < curve.length; i++) {
    const [x0, y0] = curve[i - 1];
    const [x1, y1] = curve[i];
    if (x <= x1) return y0 + ((x - x0) / (x1 - x0 || 1)) * (y1 - y0);
  }
  return curve[curve.length - 1][1];
}

/**
 * Normalise raw components to 0..1. Stakes only amplify a game that was actually competitive:
 * the stakes component is scaled by sqrt(competitiveness), the best of closeness, swing,
 * lead changes and (late) comeback, so a blowout final gets little credit for being a final.
 */
export function normalize(raw, scales) {
  const n = {
    swing: clamp01(raw.swing / scales.swing),
    closeness: clamp01(raw.closeness),
    leadChanges: clamp01(raw.leadChanges / scales.leadChanges),
    comeback: clamp01(raw.comeback),
    novelty: clamp01(raw.novelty),
    pace: clamp01(raw.pace / scales.pace),
  };
  const comp = Math.max(n.closeness, n.swing, n.leadChanges, n.comeback);
  n.stakes = clamp01(raw.stakes) * Math.sqrt(comp);
  n.quality = clamp01(raw.quality ?? 0.5);
  return n;
}

export function weighted(norm, weights) {
  let s = 0;
  let w = 0;
  for (const [k, wk] of Object.entries(weights)) {
    if (norm[k] == null) continue;
    s += wk * norm[k];
    w += wk;
  }
  return w ? s / w : 0;
}

export function normalizeF1(raw, scales) {
  return {
    leadChanges: clamp01(raw.leadChanges / scales.leadChanges),
    overtakes: clamp01(raw.overtakes / scales.overtakes),
    finalGap: clamp01(raw.finalGap),
    incidents: clamp01(raw.incidents),
    stakes: clamp01(raw.stakes),
  };
}

/** Build a usable calibration object from a calibration file (or defaults when missing). */
export function prepareCalibration(file, league) {
  const isF1 = league === 'f1';
  const defaults = isF1 ? RATING.f1.scales : (RATING.leagues[league]?.scales || { swing: 3, leadChanges: 8, pace: 1.6 });
  const empty = { league, n: 0, scales: { ...defaults }, finals: null, prior: null, generated: null };
  if (!file?.rows?.length) return empty;
  const cols = file.columns || (isF1 ? F1_COMPONENTS : COMPONENTS);
  const rows = file.rows.map((r) => {
    const o = Object.fromEntries(cols.map((c, i) => [c, r[i]]));
    if (!isF1 && o.quality == null) o.quality = 0.5;
    return o;
  });
  const scales = { ...defaults };
  for (const k of isF1 ? F1_SCALED : SCALED) {
    const v = quantile(rows.map((r) => r[k]).filter(Number.isFinite).sort(asc), 0.95);
    if (v > 0) scales[k] = v;
  }
  const weights = isF1 ? RATING.f1.weights : RATING.weights;
  const finals = rows.map((r) => weighted(isF1 ? normalizeF1(r, scales) : normalize(r, scales), weights)).sort(asc);
  const prior = Array.isArray(file.prior) && file.prior.length ? [...file.prior].filter(Number.isFinite).sort(asc) : null;
  return { league, n: rows.length, scales, finals, prior, generated: file.generated || null, seasons: file.seasons || null };
}

export function rawToRating(raw, cal) {
  let p;
  if (cal?.finals?.length >= 20) p = percentile(cal.finals, raw);
  else {
    const { median, spread } = RATING.fallbackDistribution;
    p = normCdf((raw - median) / spread);
  }
  return curveValue(p);
}

/**
 * Pre-game prior -> predicted rating. Anchored on the league's past games: the median prior maps
 * to 50 and the 90th / 10th percentiles to +-35 points (before the `spread` shrink). A tanh soft
 * cap keeps the order among exceptional games (a Game 7 still beats a marquee regular-season game)
 * instead of flattening everything above the sample maximum.
 */
export function priorToRating(raw, cal) {
  const { spread, min, max } = RATING.prior;
  let z;
  if (cal?.prior?.length >= 20) {
    const med = quantile(cal.prior, 0.5);
    const hi = quantile(cal.prior, 0.9);
    const lo = quantile(cal.prior, 0.1);
    z = raw >= med ? (raw - med) / Math.max(1e-6, hi - med) : (raw - med) / Math.max(1e-6, med - lo);
  } else {
    z = (raw - 0.45) / 0.15;
  }
  const lin = 35 * z * spread;
  const top = max - 50;
  const bottom = 50 - min;
  return lin >= 0 ? 50 + top * Math.tanh(lin / top) : 50 + bottom * Math.tanh(lin / bottom);
}

// ---------- loading ----------

const CAL_DIR = new URL('../../data/calibration/', import.meta.url);
const cache = new Map();

async function readJson(url) {
  if (url.protocol === 'file:') {
    const { readFile } = await import('node:fs/promises');
    return JSON.parse(await readFile(url, 'utf8'));
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`calibration ${res.status}`);
  return res.json();
}

/** Calibration for a league (cached). Never throws: falls back to defaults. */
export function getCalibration(league) {
  if (!cache.has(league)) {
    cache.set(league, readJson(new URL(`${league}.json`, CAL_DIR))
      .then((file) => prepareCalibration(file, league))
      .catch(() => prepareCalibration(null, league)));
  }
  return cache.get(league);
}

/** Tests and scripts can inject calibration files directly. */
export function setCalibration(league, file) {
  cache.set(league, Promise.resolve(prepareCalibration(file, league)));
}
