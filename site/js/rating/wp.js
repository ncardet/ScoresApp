// Fallback win-probability models, used when ESPN publishes no per-play win probability
// (NHL, all soccer, and the occasional college game). All return the HOME team's probability.
//
//   margin  (basketball, football): Brownian motion on the score margin (Stern 1994).
//   poisson (soccer, hockey): remaining goals for each side ~ Poisson(rate x time left).
//   runs    (baseball): normal approximation to the remaining run differential.

export function normCdf(x) {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989422804 * Math.exp((-x * x) / 2);
  const p = d * t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return x > 0 ? 1 - p : p;
}

/** Inverse normal CDF (Acklam's approximation). */
export function invNormCdf(p) {
  if (p <= 0) return -8;
  if (p >= 1) return 8;
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const pl = 0.02425;
  let q;
  let r;
  if (p < pl) {
    q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p > 1 - pl) {
    q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  q = p - 0.5;
  r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

/**
 * Margin model. `margin` = home - away now; `fRemain` = fraction of regulation left;
 * `sigma` = SD of the final margin over a whole game; `drift` = expected home margin over a whole game.
 */
export function marginWp(margin, fRemain, sigma, drift = 0) {
  if (fRemain <= 1e-6) return margin > 0 ? 1 : margin < 0 ? 0 : 0.5;
  const sd = sigma * Math.sqrt(fRemain);
  // +-0.5 continuity correction: a tie at the end goes to overtime (~coin flip).
  const pWin = 1 - normCdf((-margin - drift * fRemain + 0.5) / sd);
  const pLose = normCdf((-margin - drift * fRemain - 0.5) / sd);
  const pTie = Math.max(0, 1 - pWin - pLose);
  return pWin + 0.5 * pTie;
}

/** Drift (expected home margin per game) implied by a pre-game home win probability. */
export function driftFromProb(p, sigma) {
  if (p == null || !Number.isFinite(p)) return 0;
  return sigma * invNormCdf(Math.min(0.99, Math.max(0.01, p)));
}

function poissonPmf(lambda, n) {
  const out = new Array(n + 1);
  let p = Math.exp(-lambda);
  out[0] = p;
  for (let k = 1; k <= n; k++) {
    p *= lambda / k;
    out[k] = p;
  }
  return out;
}

/**
 * Poisson outcome probabilities given current goal difference (home - away) and the expected
 * remaining goals for each side. Returns {win, draw, loss} for the home team.
 */
export function poissonOutcome(diff, lambdaHome, lambdaAway) {
  const N = 12;
  const ph = poissonPmf(Math.max(0, lambdaHome), N);
  const pa = poissonPmf(Math.max(0, lambdaAway), N);
  let win = 0;
  let draw = 0;
  for (let x = 0; x <= N; x++) {
    for (let y = 0; y <= N; y++) {
      const p = ph[x] * pa[y];
      const d = diff + x - y;
      if (d > 0) win += p;
      else if (d === 0) draw += p;
    }
  }
  const loss = Math.max(0, 1 - win - draw);
  return { win, draw, loss };
}

/**
 * Split an expected total of goals per game between home and away so that the Poisson
 * model reproduces a pre-game (home win - away win) edge. Without odds: small home edge.
 */
export function splitRates(total, preHome, preAway) {
  if (preHome == null || preAway == null) return { home: total * 0.53, away: total * 0.47 };
  const target = preHome - preAway;
  let lo = 0.05;
  let hi = 0.95;
  for (let i = 0; i < 40; i++) {
    const s = (lo + hi) / 2;
    const o = poissonOutcome(0, total * s, total * (1 - s));
    if (o.win - o.loss < target) lo = s; else hi = s;
  }
  const s = (lo + hi) / 2;
  return { home: total * s, away: total * (1 - s) };
}

/**
 * Soccer: home "result share" = P(win) + 0.5 * P(draw). `fRemain` in units of 90 minutes.
 * `drawValue` lets knockout extra time / penalties treat a draw as a coin flip.
 */
export function soccerWp(diff, fRemain, rates, drawValue = 0.5) {
  if (fRemain <= 1e-6) return diff > 0 ? 1 : diff < 0 ? 0 : drawValue;
  const o = poissonOutcome(diff, rates.home * fRemain, rates.away * fRemain);
  return o.win + drawValue * o.draw;
}

/** Hockey: a regulation tie goes to OT/shootout, won by home with probability `otHome`. */
export function hockeyWp(diff, fRemain, rates, otHome = 0.52) {
  if (fRemain <= 1e-6) return diff > 0 ? 1 : diff < 0 ? 0 : otHome;
  const o = poissonOutcome(diff, rates.home * fRemain, rates.away * fRemain);
  return o.win + otHome * o.draw;
}

/**
 * Baseball: remaining run differential ~ Normal(0, (sigma^2) * fRemain), sigma ~= 4.4 runs.
 * `fRemain` = remaining outs / 54. Ties after regulation go to extras (home ~52%).
 */
export function runsWp(diff, fRemain, sigma = 4.4, drift = 0) {
  if (fRemain <= 1e-6) return diff > 0 ? 1 : diff < 0 ? 0 : 0.52;
  const sd = sigma * Math.sqrt(fRemain);
  const pWin = 1 - normCdf((-diff - drift * fRemain + 0.5) / sd);
  const pLose = normCdf((-diff - drift * fRemain - 0.5) / sd);
  return pWin + 0.52 * Math.max(0, 1 - pWin - pLose);
}
