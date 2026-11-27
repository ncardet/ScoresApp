// FiveThirtyEight-style Elo: margin-of-victory multiplier, home advantage, offseason regression.
// Pure functions, shared by the nightly job, the backtest and the app.

import CFG from '../../config/prediction.json' with { type: 'json' };

export function params(league) {
  const p = CFG.elo[league];
  if (!p) throw new Error(`No Elo params for ${league}`);
  return p;
}

/** Elo pool key: UCL and UEL share one pool (clubs move between them). */
export const poolOf = (league) => CFG.elo[league]?.pool || league;

/** Expected score for the home side. `neutral` removes home advantage. */
export function expected(rHome, rAway, { hfa = 0, neutral = false } = {}) {
  const d = rHome + (neutral ? 0 : hfa) - rAway;
  return 1 / (1 + 10 ** (-d / 400));
}

/** Elo gap including home advantage (positive = home stronger). */
export function eloDiff(rHome, rAway, { hfa = 0, neutral = false } = {}) {
  return rHome + (neutral ? 0 : hfa) - rAway;
}

/**
 * Margin-of-victory multiplier. `diffWinner` is the winner's Elo minus the loser's (incl. home
 * advantage); dividing by it damps autocorrelation (favorites winning big gain less).
 */
export function movMultiplier(family, mov, diffWinner) {
  const m = Math.abs(mov);
  switch (family) {
    case 'football':
      return Math.log(m + 1) * (2.2 / (diffWinner * 0.001 + 2.2));
    case 'basketball':
      return ((m + 3) ** 0.8) / (7.5 + 0.006 * diffWinner);
    case 'baseball':
    case 'hockey':
      return Math.max(1, Math.log(m + 1)) * (2.0 / (diffWinner * 0.001 + 2.0));
    case 'soccer':
      return m <= 1 ? 1 : m === 2 ? 1.5 : (11 + m) / 8;
    default:
      return 1;
  }
}

/**
 * Update two ratings after a result. Returns { home, away, delta }.
 * `homeScore`/`awayScore` are final scores; a tie is a draw (soccer) - for sports without ties
 * the caller passes the winner's result (OT/shootout winner counts as a win).
 */
export function update(rHome, rAway, homeScore, awayScore, league, { neutral = false, winner = null } = {}) {
  const p = params(league);
  const e = expected(rHome, rAway, { hfa: p.hfa, neutral });
  let s;
  if (winner === 'home') s = 1;
  else if (winner === 'away') s = 0;
  else s = homeScore > awayScore ? 1 : homeScore < awayScore ? 0 : 0.5;
  const mov = homeScore - awayScore;
  const diff = eloDiff(rHome, rAway, { hfa: p.hfa, neutral });
  const diffWinner = s === 1 ? diff : s === 0 ? -diff : 0;
  const mult = s === 0.5 ? 1 : movMultiplier(p.mov, mov || 1, diffWinner);
  const delta = p.k * mult * (s - e);
  return { home: rHome + delta, away: rAway - delta, delta, expected: e };
}

/** Offseason regression toward the league mean. */
export function regress(r, league) {
  const p = params(league);
  return p.mean + (r - p.mean) * p.carry;
}

/** Soccer draw probability from the Elo gap. */
export function drawProb(diff) {
  const { d0, width } = CFG.elo.draw;
  return d0 * Math.exp(-((diff / width) ** 2));
}

/**
 * Win / draw / loss probabilities for the home side.
 * Two-way sports: draw = 0. Soccer keeps Elo's expected score (pH + pD/2 = E).
 */
export function probabilities(rHome, rAway, league, { neutral = false } = {}) {
  const p = params(league);
  const diff = eloDiff(rHome, rAway, { hfa: p.hfa, neutral });
  const e = 1 / (1 + 10 ** (-diff / 400));
  if (p.mov !== 'soccer') return { home: e, draw: 0, away: 1 - e, diff };
  const d = drawProb(diff);
  let home = e - d / 2;
  let away = 1 - e - d / 2;
  home = Math.max(0.02, home);
  away = Math.max(0.02, away);
  const s = home + away + d;
  return { home: home / s, draw: d / s, away: away / s, diff };
}

/** Point spread implied by an Elo gap (home perspective; negative = home favored), football/basketball. */
export function spreadFromElo(diff, league) {
  const pps = CFG.elo[league]?.pointsPerSpread;
  return pps ? -diff / pps : null;
}
