// Basic tennis rating (optional league: Grand Slam singles), from the set scores alone; ESPN's feed
// has no point-by-point data. 50 = an ordinary match. A deciding set, tiebreaks, close sets and a
// comeback push it up; one-sided sets pull it down; later rounds add a little.

import RATING from '../../config/rating.js';

const BASE = 50;
const ROUND_BONUS = [[/^final$/i, 12], [/semifinal/i, 7], [/quarterfinal/i, 4]];

const clamp = (x) => Math.max(1, Math.min(99, Math.round(x)));
const band = (v) => RATING.bands.find((b) => v >= b.min) || RATING.bands.at(-1);

function roundBonus(round = '') {
  for (const [re, pts] of ROUND_BONUS) if (re.test(round)) return pts;
  return 0;
}

/** Pre-match: the base rate plus the round. */
export function predictedTennis(game) {
  const value = clamp(BASE + roundBonus(game.round));
  return { state: 'predicted', value, band: band(value), reasons: [], explain: game.round || 'Grand Slam match', engine: 'tennis-1' };
}

/** Live or final rating from the sets played so far. */
export function rateTennis(game) {
  const a = game.away?.sets || [];
  const b = game.home?.sets || [];
  const n = Math.max(a.length, b.length);
  if (game.state === 'pre' || !n) return predictedTennis(game);
  const bestOf = game.bestOf || 3;
  const final = game.state === 'post';
  const reasons = [];
  let v = BASE;
  let tiebreaks = 0;
  let close = 0;
  let routs = 0;
  let lastTiebreak = false;
  for (let i = 0; i < n; i++) {
    const x = a[i]?.g ?? 0;
    const y = b[i]?.g ?? 0;
    const tb = a[i]?.tb != null || b[i]?.tb != null || (Math.max(x, y) === 7 && Math.min(x, y) === 6);
    if (tb) tiebreaks++;
    else if (Math.max(x, y) >= 6 && Math.abs(x - y) <= 2) close++;
    else if (Math.max(x, y) >= 6 && Math.min(x, y) <= 2) routs++; // 6-0, 6-1, 6-2
    if (i === n - 1) lastTiebreak = tb;
  }
  const deciding = n === bestOf;
  if (deciding) {
    v += 22;
    reasons.push(bestOf === 5 ? 'Five sets' : 'Went the distance');
    if (lastTiebreak) { v += 8; reasons.push('Deciding-set tiebreak'); }
  } else if (bestOf === 5 && n === 4) {
    v += 8;
    reasons.push('Four sets');
  }
  if (tiebreaks) {
    v += Math.min(3, tiebreaks) * 7;
    reasons.push(tiebreaks === 1 ? 'A tiebreak' : `${tiebreaks} tiebreaks`);
  }
  v += Math.min(3, close) * 3;
  // Comeback: the winner dropped the opening set(s).
  const winner = game.away?.winner ? a : game.home?.winner ? b : null;
  if (final && winner) {
    const lostOpening = winner.findIndex((s) => s.won);
    if (bestOf === 5 && lostOpening >= 2) { v += 12; reasons.push('Came back from two sets down'); }
    else if (lostOpening >= 1) { v += 4; reasons.push('Came back from a set down'); }
  }
  if (final && routs === n && n === Math.ceil(bestOf / 2)) {
    v -= 15;
    reasons.push('One-sided');
  } else {
    v -= routs * 4;
  }
  const rb = roundBonus(game.round);
  if (rb) { v += rb; reasons.push(game.round); }
  const value = clamp(v);
  return {
    state: final ? 'final' : 'live',
    value,
    band: band(value),
    reasons: reasons.map((text) => ({ text })),
    explain: reasons.join(' · ') || (final ? 'Routine match' : 'In progress'),
    engine: 'tennis-1',
  };
}
