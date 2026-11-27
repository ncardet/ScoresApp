// Small statistics toolkit for the backtest: ridge and logistic regression, rank metrics.
// No dependencies; matrices are arrays of arrays.

export const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN);
export const median = (a) => quantile([...a].sort((x, y) => x - y), 0.5);

export function quantile(sorted, q) {
  if (!sorted.length) return NaN;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/** Solve A x = b (Gaussian elimination with partial pivoting). */
export function solve(A, b) {
  const n = A.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    if (Math.abs(M[c][c]) < 1e-12) continue;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((row, i) => (Math.abs(row[i]) < 1e-12 ? 0 : row[n] / row[i]));
}

/**
 * Ridge regression on standardised features. Returns raw-scale { intercept, coef }.
 * `lambda` is relative to n (penalty = lambda * n * ||beta_std||^2).
 */
export function ridge(X, y, lambda = 1) {
  const n = X.length;
  const p = X[0]?.length || 0;
  const mu = Array.from({ length: p }, (_, j) => mean(X.map((r) => r[j])));
  const sd = Array.from({ length: p }, (_, j) => Math.sqrt(mean(X.map((r) => (r[j] - mu[j]) ** 2))) || 0);
  const ym = mean(y);
  const Z = X.map((r) => r.map((v, j) => (sd[j] ? (v - mu[j]) / sd[j] : 0)));
  const A = Array.from({ length: p }, (_, i) => Array.from({ length: p }, (_, j) => {
    let s = 0;
    for (let k = 0; k < n; k++) s += Z[k][i] * Z[k][j];
    return s + (i === j ? lambda * n : 0);
  }));
  const b = Array.from({ length: p }, (_, i) => {
    let s = 0;
    for (let k = 0; k < n; k++) s += Z[k][i] * (y[k] - ym);
    return s;
  });
  const beta = solve(A, b);
  const coef = beta.map((bj, j) => (sd[j] ? bj / sd[j] : 0));
  const intercept = ym - coef.reduce((s, c, j) => s + c * mu[j], 0);
  return { intercept, coef };
}

export const predictLinear = (m, x) => m.intercept + m.coef.reduce((s, c, j) => s + c * x[j], 0);

const sigmoid = (z) => 1 / (1 + Math.exp(-z));

/** One-variable logistic regression P(y=1) = sigmoid(a + b x), Newton's method with a small L2. */
export function logistic1(x, y, { l2 = 1e-3, iters = 50 } = {}) {
  const xm = mean(x);
  const xs = Math.sqrt(mean(x.map((v) => (v - xm) ** 2))) || 1;
  let a = 0;
  let b = 0;
  for (let it = 0; it < iters; it++) {
    let ga = 0; let gb = 0; let haa = 0; let hab = 0; let hbb = 0;
    for (let i = 0; i < x.length; i++) {
      const z = (x[i] - xm) / xs;
      const p = sigmoid(a + b * z);
      const w = p * (1 - p);
      ga += y[i] - p; gb += (y[i] - p) * z;
      haa += w; hab += w * z; hbb += w * z * z;
    }
    gb -= l2 * x.length * b;
    hbb += l2 * x.length;
    const det = haa * hbb - hab * hab;
    if (Math.abs(det) < 1e-12) break;
    const da = (hbb * ga - hab * gb) / det;
    const db = (haa * gb - hab * ga) / det;
    a += da; b += db;
    if (Math.abs(da) + Math.abs(db) < 1e-8) break;
  }
  // Back to the raw scale of x.
  return [a - (b * xm) / xs, b / xs];
}

export function ranks(a) {
  const idx = a.map((v, i) => [v, i]).sort((p, q) => p[0] - q[0]);
  const r = new Array(a.length);
  for (let i = 0; i < idx.length;) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) r[idx[k][1]] = avg;
    i = j + 1;
  }
  return r;
}

export function pearson(a, b) {
  const ma = mean(a);
  const mb = mean(b);
  let s = 0; let sa = 0; let sb = 0;
  for (let i = 0; i < a.length; i++) {
    s += (a[i] - ma) * (b[i] - mb);
    sa += (a[i] - ma) ** 2;
    sb += (b[i] - mb) ** 2;
  }
  return sa && sb ? s / Math.sqrt(sa * sb) : NaN;
}

export const spearman = (a, b) => pearson(ranks(a), ranks(b));

/** Mann-Whitney AUC: probability a random positive scores above a random negative. */
export function auc(scoresPos, scoresNeg) {
  if (!scoresPos.length || !scoresNeg.length) return NaN;
  const all = [...scoresPos.map((s) => [s, 1]), ...scoresNeg.map((s) => [s, 0])];
  const r = ranks(all.map((x) => x[0]));
  let sumPos = 0;
  all.forEach((x, i) => { if (x[1]) sumPos += r[i]; });
  const nP = scoresPos.length;
  const nN = scoresNeg.length;
  return (sumPos - (nP * (nP + 1)) / 2) / (nP * nN);
}
