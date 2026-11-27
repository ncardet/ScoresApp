// Betting-line maths. Moneyline -> implied probability, bookmaker margin removed by normalising
// all outcomes to sum to 1. p_fav = the favourite's no-vig win probability.

/** American moneyline -> implied probability (with the bookmaker's margin still in). */
export function moneylineToProb(ml) {
  const v = typeof ml === 'string' ? parseFloat(ml.replace(/[^\d.+-]/g, '')) : ml;
  if (!Number.isFinite(v) || v === 0) return null;
  return v > 0 ? 100 / (v + 100) : -v / (-v + 100);
}

/** Remove the margin: scale implied probabilities so they sum to 1. Nulls are skipped. */
export function removeMargin(probs) {
  const vals = Object.values(probs).filter((p) => p != null);
  const sum = vals.reduce((a, b) => a + b, 0);
  if (!sum) return null;
  return Object.fromEntries(Object.entries(probs).map(([k, p]) => [k, p == null ? null : p / sum]));
}

/** No-vig probabilities from moneylines {home, away, draw?}. */
export function noVig({ home, away, draw = null }) {
  const p = removeMargin({ home: moneylineToProb(home), away: moneylineToProb(away), draw: draw == null ? null : moneylineToProb(draw) });
  if (!p || p.home == null || p.away == null) return null;
  return { home: p.home, away: p.away, draw: p.draw ?? 0 };
}

/** Favourite's probability: max of the two sides (two-way) after the margin is removed. */
export function pFav(probs) {
  if (!probs) return null;
  return Math.max(probs.home ?? 0, probs.away ?? 0);
}

/**
 * Parse ESPN's `details` string ("LAL -1.5", "EVEN", "PK") into { team, line }.
 * Returns null when it is not a spread string.
 */
export function parseDetails(details) {
  const s = String(details || '').trim();
  if (/^(pk|pick|even)/i.test(s)) return { team: null, line: 0 };
  const m = s.match(/^([A-Z0-9&.]{2,6})\s+([+-]?\d+(?:\.\d+)?)$/i);
  return m ? { team: m[1].toUpperCase(), line: parseFloat(m[2]) } : null;
}

const fmt = (x) => (Number.isInteger(x) ? String(x) : x.toFixed(1));

/** Absolute spread and display string ("LAL −1.5") from normalised odds. */
export function spreadInfo(odds, home, away) {
  if (!odds) return null;
  const d = parseDetails(odds.details);
  let abs = odds.spread != null ? Math.abs(odds.spread) : d ? Math.abs(d.line) : null;
  if (abs == null) return null;
  let fav = d?.team || null;
  if (!fav && odds.spread != null && odds.spread !== 0) fav = odds.spread < 0 ? home?.abbr : away?.abbr;
  abs = Math.round(abs * 2) / 2;
  return { abs, text: abs === 0 ? 'pick’em' : `${fav || 'fav'} −${fmt(abs)}`, fav };
}
