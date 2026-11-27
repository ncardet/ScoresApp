// Calibration rows from the backfilled target cache (.cache/targets), shared by the backtest
// (which writes site/data/calibration/<league>.json) and the rating tuner, so both see exactly the
// rows the app will load.
//
// Rows are raw components in COMPONENTS order. They depend on swingLateBoost and
// comebackLateness (see componentsFrom), so changing those needs a recalibration; changing the
// weights or amplifiers does not (the app re-weights the rows when it loads them).

import RATING from '../../site/config/rating.js';
import { componentsFrom } from '../../site/js/rating/index.js';
import { COMPONENTS } from '../../site/js/rating/calibrate.js';

export const CAL_ROWS_MAX = 1500;
const r4 = (x) => (Number.isFinite(x) ? Math.round(x * 1e4) / 1e4 : null);

/** Component row for one cached target entry (base measurements; legacy entries carry raw rows). */
export function targetRow(t) {
  if (t?.b) {
    const c = componentsFrom(t.b);
    return COMPONENTS.map((k) => r4(c[k]));
  }
  return Array.isArray(t?.raw) ? t.raw : null;
}

/** Deterministic sample of n items (same picks for the same input length). */
export function sample(arr, n, seed = 7) {
  if (arr.length <= n) return arr;
  const a = [...arr];
  let s = seed;
  const rand = () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, n);
}

/** A calibration file for a league from its target entries. */
export function calibrationFile(league, entries, window = '') {
  const rows = sample(entries.map(targetRow).filter(Boolean), CAL_ROWS_MAX);
  return { league, engine: RATING.version, generated: new Date().toISOString(), window, n: rows.length, columns: COMPONENTS, rows };
}
