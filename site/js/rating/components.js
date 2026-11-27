// Measure the in-game components on a timeline (see timeline.js). Returns raw values plus the
// facts the explanation needs. Normalisation to 0..1 happens in index.js using league scales.
//
//   swing        GEI = (T_reg / T_elapsed) * sum |dWP|
//   closeness    share of the late window (final 20% of regulation + OT) that was close
//   leadChanges  lead changes + ties, weighted 1 + boost * t^2 (projected to a full game when live)
//   comeback     how low the winner's (or current leader's) win probability fell
//   novelty      flags: overtime, walk-off, no-hitter, hat trick, 40-point game, red card, big comeback
//   pace         scoring (and shots) vs league norm

import RATING from '../../config/rating.js';
import { LEAGUE_BY_KEY } from '../core/leagues.js';

const clamp01 = (x) => Math.min(1, Math.max(0, x));

/** Value of a step function [{t, ...}] at time t. */
function stepAt(points, t, key) {
  let v = points[0]?.[key];
  for (const p of points) {
    if (p.t <= t + 1e-9) v = p[key]; else break;
  }
  return v;
}

/** Win probability sampled on a fixed time grid (removes per-play jitter). */
export function resample(points, progress, step) {
  const out = [];
  let j = 0;
  const end = Math.max(progress, 0);
  for (let t = 0; t <= end + 1e-9; t += step) {
    while (j < points.length - 1 && points[j + 1].t <= t + 1e-9) j++;
    out.push({ t, wp: points[j].wp });
  }
  // Always end on the latest value (final result / current state).
  let last = points[0];
  for (const p of points) if (p.t <= end + 1e-9) last = p;
  out.push({ t: end, wp: last.wp });
  return out;
}

/** Integral of the late weight 1 + k*t^2 over [0, p] (overtime weighs 1 + k). */
function weightMass(p, k) {
  const a = Math.min(p, 1);
  return a + (k * a ** 3) / 3 + Math.max(0, p - 1) * (1 + k);
}

/**
 * Swing (GEI): (T_reg / T_elapsed) * sum |dWP|. Two configurable refinements (config/rating.js):
 *   swingResample   sample WP on a fixed grid so per-play noise does not pile up
 *   swingLateBoost  a swing at time t counts 1 + k*t^2, normalised so a game with evenly
 *                   spread swings scores the same as the plain GEI (k = 0 is textbook GEI)
 */
export function swing(points, progress) {
  const k = RATING.swingLateBoost || 0;
  const step = RATING.swingResample || 0;
  const series = step ? resample(points, progress, step) : points.filter((p) => p.t <= progress + 1e-9);
  let sum = 0;
  let weightedSum = 0;
  let lateSum = 0;
  const late = 1 - RATING.lateWindow;
  for (let i = 1; i < series.length; i++) {
    const d = Math.abs(series[i].wp - series[i - 1].wp);
    const t = series[i].t;
    sum += d;
    weightedSum += d * (1 + k * Math.min(t, 1) ** 2); // overtime (t > 1) gets the full late weight
    if (t >= late) lateSum += d;
  }
  const elapsed = Math.max(progress, 1 / RATING.maxSwingExtrapolation);
  // Swing per tenth of regulation (+ overtime), so the late weighting can be re-tuned from cache.
  const bins = new Array(11).fill(0);
  for (let i = 1; i < series.length; i++) {
    const t = series[i].t;
    bins[t >= 1 ? 10 : Math.min(9, Math.floor(t * 10))] += Math.abs(series[i].wp - series[i - 1].wp);
  }
  return { raw: weightedSum / weightMass(elapsed, k), sum, lateSum, bins, elapsed };
}

/** Swing from per-tenth bins with late boost k (see swing()). */
export function swingFromBins(bins, elapsed, k) {
  let s = 0;
  for (let i = 0; i < bins.length; i++) {
    const t = i === 10 ? 1 : (i + 0.5) / 10;
    s += bins[i] * (1 + k * Math.min(t, 1) ** 2);
  }
  return s / weightMass(Math.max(elapsed, 1 / RATING.maxSwingExtrapolation), k);
}

/** Fraction of [start, end] that is close (WP in band or margin within one score). */
export function closeness(points, scores, start, end, oneScore) {
  if (end - start < 1e-6) {
    const wp = stepAt(points, end, 'wp');
    const s = scores.length ? stepAt(scores, end, 'hs') - stepAt(scores, end, 'as') : 0;
    return { raw: isClose(wp, s, oneScore) ? 1 : 0, start, end };
  }
  const [lo, hi] = RATING.closeWp;
  // Merge breakpoints of both step functions inside the window.
  const ts = new Set([start, end]);
  for (const p of points) if (p.t > start && p.t < end) ts.add(p.t);
  for (const s of scores) if (s.t > start && s.t < end) ts.add(s.t);
  const sorted = [...ts].sort((a, b) => a - b);
  let closeTime = 0;
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i];
    const b = sorted[i + 1];
    const wp = stepAt(points, a, 'wp');
    const margin = stepAt(scores, a, 'hs') - stepAt(scores, a, 'as');
    if ((wp >= lo && wp <= hi) || Math.abs(margin) <= oneScore) closeTime += b - a;
  }
  return { raw: clamp01(closeTime / (end - start)), start, end };

  function isClose(wp, margin, one) {
    return (wp >= lo && wp <= hi) || Math.abs(margin) <= one;
  }
}

/** Lead changes and ties along the score series. */
export function leadChanges(scores, progress, live) {
  const boost = RATING.leadChangeLateBoost;
  const late = 1 - RATING.lateWindow;
  let prevSign = 0;
  let lastLeader = 0;
  let weighted = 0;
  let changes = 0;
  let ties = 0;
  let lateCount = 0;
  let lastChangeT = null;
  for (let i = 1; i < scores.length; i++) {
    const s = scores[i];
    if (s.t > progress + 1e-9) break;
    const sign = Math.sign(s.hs - s.as);
    if (sign === prevSign) continue;
    const w = 1 + boost * Math.min(1, s.t) ** 2;
    let counted = false;
    if (sign === 0 && prevSign !== 0) { ties++; counted = true; }
    else if (sign !== 0 && lastLeader !== 0 && sign !== lastLeader) { changes++; counted = true; lastChangeT = s.t; }
    if (counted) {
      weighted += w;
      if (s.t >= late) lateCount++;
    }
    if (sign !== 0) lastLeader = sign;
    prevSign = sign;
  }
  // Live: project the weighted count to a full game, assuming events keep arriving at the same rate.
  let raw = weighted;
  if (live && progress > 0 && progress < 1) {
    const full = 1 + boost / 3;
    const p = Math.max(progress, 0.25);
    raw = weighted * full / (p + boost * p ** 3 / 3);
  }
  return { raw, changes, ties, late: lateCount, lastChangeT };
}

/** Comeback: lowest win probability of the eventual winner (final) or the current leader (live). */
export function comeback(points, scores, progress, final, result) {
  const last = scores.filter((s) => s.t <= progress + 1e-9).at(-1) || { hs: 0, as: 0 };
  let sides;
  if (final) sides = result === 1 ? ['home'] : result === 0 ? ['away'] : ['home', 'away'];
  else {
    const d = last.hs - last.as;
    sides = d > 0 ? ['home'] : d < 0 ? ['away'] : ['home', 'away'];
  }
  let best = { raw: 0, minWp: 0.5, side: null, deficit: 0, t: 0 };
  for (const side of sides) {
    let minWp = 1;
    let tMin = 0;
    for (const p of points) {
      if (p.t > progress + 1e-9) break;
      const v = side === 'home' ? p.wp : 1 - p.wp;
      if (v < minWp) { minWp = v; tMin = p.t; }
    }
    let deficit = 0;
    for (const s of scores) {
      if (s.t > progress + 1e-9) break;
      const d = side === 'home' ? s.as - s.hs : s.hs - s.as;
      if (d > deficit) deficit = d;
    }
    const raw = clamp01((0.5 - minWp) / 0.45);
    // t = when the winner (leader) was in the deepest hole: late comebacks matter more.
    if (raw > best.raw || (raw === best.raw && deficit > best.deficit)) best = { raw, minWp, side, deficit, t: tMin };
  }
  return best;
}

function homeResult(game, scores) {
  if (game.home?.winner) return 1;
  if (game.away?.winner) return 0;
  const last = scores.at(-1) || { hs: 0, as: 0 };
  const hs = game.home?.score ?? last.hs;
  const as = game.away?.score ?? last.as;
  return hs > as ? 1 : as > hs ? 0 : 0.5;
}

function plural(n, word) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

/** Novelty flags with weights and labels. */
export function novelty(tl, detail, result) {
  const game = detail.game;
  const lg = LEAGUE_BY_KEY[game.league];
  const N = RATING.novelty;
  const flags = [];
  const add = (key, weight, label) => flags.push({ key, weight, label });
  const leagueFlag = (key) => (RATING.leagueNovelty?.[lg.key] || []).includes(key);
  const plays = detail.plays || [];
  const final = tl.final;
  const maxPeriod = Math.max(game.period || 0, ...plays.map((p) => p.period || 0));

  if (['basketball', 'football', 'hockey'].includes(lg.sport)) {
    let ot = Math.max(0, maxPeriod - lg.periods);
    const shootout = lg.sport === 'hockey' && game.seasonType !== 3 && (maxPeriod >= 5 || plays.some((p) => p.shootout) || /SO/.test(game.detail || ''));
    if (shootout) ot = 1;
    if (ot >= 1) add('overtime', N.overtime + (ot - 1) * N.extraOvertime, ot === 1 ? 'Overtime' : `${ot} overtimes`);
    if (shootout) add('shootout', N.shootout, 'Shootout');
  }
  if (lg.sport === 'baseball') {
    const innings = Math.max(maxPeriod, game.period || 0);
    if (innings > 9) add('extraInnings', N.extraInnings, `Extra innings (${innings})`);
  }
  if (lg.sport === 'soccer') {
    const ke = detail.soccer?.keyEvents || [];
    const et = /AET|PEN|extra/i.test(`${game.detail} ${game.statusName || ''}`) || ke.some((k) => k.period >= 3) || game.period >= 3;
    const pens = /PEN|penalt/i.test(game.detail || '') || ke.some((k) => k.shootout) || game.home?.shootout != null;
    if (et) add('overtime', N.overtime, 'Extra time');
    if (pens) add('penalties', N.penalties, 'Penalty shootout');
    const reds = ke.filter((k) => /red-card/.test(k.type)).length || (game.soccer?.events || []).filter((e) => e.type === 'red').length;
    if (reds) add('redCard', N.redCard * Math.min(2, reds), reds === 1 ? 'Red card' : `${reds} red cards`);
    // Hat trick.
    const goals = {};
    for (const g of detail.soccer?.goals || []) {
      if (g.type === 'own-goal' || /own goal/i.test(g.text || '')) continue;
      if (g.athlete) goals[g.athlete] = (goals[g.athlete] || 0) + 1;
    }
    for (const [who, n] of Object.entries(goals)) if (n >= 3) add('hatTrick', N.hatTrick, `Hat trick: ${who}${n > 3 ? ` (${n})` : ''}`);
  }
  if (lg.sport === 'hockey') {
    const goals = {};
    for (const p of plays) if (p.scoring && !p.shootout && p.athlete) goals[p.athlete] = (goals[p.athlete] || 0) + 1;
    for (const [who, n] of Object.entries(goals)) if (n >= 3) add('hatTrick', N.hatTrick, `Hat trick: ${who}`);
  }
  if (lg.sport === 'basketball' && detail.box) {
    let top = null;
    for (const team of detail.box) {
      for (const g of team.groups) {
        const idx = g.keys.indexOf('points');
        if (idx < 0) continue;
        for (const r of g.rows) {
          const pts = parseInt(r.stats[idx], 10);
          if (Number.isFinite(pts) && (!top || pts > top.pts)) top = { pts, who: r.name };
        }
      }
    }
    if (top && top.pts >= 50) add('fiftyPoints', N.fiftyPoints, `${top.who}: ${top.pts} points`);
    else if (top && top.pts >= 40) add('fortyPoints', N.fortyPoints, `${top.who}: ${top.pts} points`);
    // League-only stat lines (WNBA): 20/20 games and triple-doubles.
    if (leagueFlag('twentyTwenty') || leagueFlag('tripleDouble')) {
      let twenty = null;
      let triple = null;
      for (const team of detail.box) {
        for (const g of team.groups) {
          const at = (k) => g.keys.indexOf(k);
          const cols = ['points', 'rebounds', 'assists', 'steals', 'blocks'].map(at);
          if (cols[0] < 0 || cols[1] < 0) continue;
          for (const r of g.rows) {
            const [pts, reb, ast, stl, blk] = cols.map((i) => (i < 0 ? 0 : parseInt(r.stats[i], 10) || 0));
            if (!twenty && pts >= 20 && reb >= 20) twenty = `${r.name}: ${pts} points, ${reb} rebounds`;
            if (!triple && [pts, reb, ast, stl, blk].filter((x) => x >= 10).length >= 3) triple = `Triple-double: ${r.name} (${pts}-${reb}-${ast})`;
          }
        }
      }
      if (twenty && leagueFlag('twentyTwenty')) add('twentyTwenty', N.twentyTwenty, twenty);
      if (triple && leagueFlag('tripleDouble')) add('tripleDouble', N.tripleDouble, triple);
    }
  }
  if (lg.sport === 'baseball') {
    // Hits by batting side, from play results.
    const hits = { home: 0, away: 0 };
    let inning = 1;
    for (const p of plays) {
      if (p.hit && p.result !== false) hits[p.side] = (hits[p.side] || 0) + 1;
      inning = Math.max(inning, p.period || 1);
    }
    // The scoreboard's per-team hit totals are authoritative when we have them.
    const bb = game.baseball;
    if (bb?.homeHits != null) hits.home = bb.homeHits;
    if (bb?.awayHits != null) hits.away = bb.awayHits;
    for (const side of ['home', 'away']) {
      if (hits[side] !== 0) continue;
      const pitching = side === 'home' ? game.away : game.home;
      if (final && inning >= 9) add('noHitter', N.noHitter, `No-hitter by ${pitching?.short || 'the pitching staff'}`);
      else if (!final && inning >= 7) add('noHitterLive', N.noHitterLive, `No-hitter in progress (${ordinal(inning)} inning)`);
    }
    // Walk-off: home wins on the last scoring play in the bottom of the 9th or later.
    if (final && result === 1) {
      const scoring = tl.scores.slice(1);
      const lastScore = scoring.at(-1);
      const before = scoring.at(-2) || { hs: 0, as: 0 };
      if (lastScore && lastScore.side === 'home' && lastScore.half === 'bottom' && (lastScore.period || 0) >= 9 && before.hs <= before.as) {
        add('walkOff', N.walkOff, 'Walk-off win');
      }
    }
  }
  // Late winner: the decisive go-ahead score came at the very end of regulation.
  if (final && result !== 0.5 && ['basketball', 'football', 'soccer', 'hockey'].includes(lg.sport)) {
    const goAhead = lastGoAhead(tl.scores, result);
    const lateT = { basketball: 0.992, football: 0.985, soccer: 0.95, hockey: 0.975 }[lg.sport];
    if (goAhead && goAhead.t >= lateT && goAhead.t <= 1.0001 && !flags.some((f) => f.key === 'overtime')) {
      add('lateWinner', N.lateWinner, lg.sport === 'soccer' ? `Winner in the ${goAhead.clock || 'final minutes'}` : 'Go-ahead score in the final seconds');
    }
  }
  // Late comeback (league-only): the winner trailed by lateComebackPoints+ inside the final minute
  // of regulation, counting the score as the final minute began.
  const lateNeed = RATING.lateComebackPoints?.[lg.key];
  if (final && lateNeed && leagueFlag('lateComeback') && result !== 0.5 && lg.periods && lg.periodMinutes) {
    const winner = result === 1 ? 'home' : 'away';
    const t0 = 1 - 1 / (lg.periods * lg.periodMinutes);
    let deficit = 0;
    let before = 0;
    for (const s of tl.scores) {
      const d = winner === 'home' ? s.as - s.hs : s.hs - s.as;
      if (s.t < t0) { before = d; continue; }
      if (s.t > 1 + 1e-9) break;
      deficit = Math.max(deficit, d);
    }
    deficit = Math.max(deficit, before);
    if (deficit >= lateNeed) add('lateComeback', N.lateComeback, `Erased a ${deficit}-point deficit in the final minute`);
  }
  // Big comeback (points).
  const need = RATING.bigComebackPoints[lg.key] ?? RATING.bigComebackPoints[lg.sport];
  if (final && need && result !== 0.5) {
    const winner = result === 1 ? 'home' : 'away';
    let deficit = 0;
    for (const s of tl.scores) {
      const d = winner === 'home' ? s.as - s.hs : s.hs - s.as;
      if (d > deficit) deficit = d;
    }
    if (deficit >= need) add('bigComeback', N.bigComeback, `Came back from ${deficit} down`);
  }
  const raw = clamp01(flags.reduce((a, f) => a + f.weight, 0));
  return { raw, flags };
}

/** The score at which the eventual winner took the lead for good. */
function lastGoAhead(scores, result) {
  const sign = result === 1 ? 1 : -1;
  let idx = -1;
  for (let i = scores.length - 1; i >= 1; i--) {
    const cur = Math.sign(scores[i].hs - scores[i].as);
    const prev = Math.sign(scores[i - 1].hs - scores[i - 1].as);
    if (cur === sign && prev !== sign) { idx = i; break; }
    if (cur !== sign) break;
  }
  return idx > 0 ? scores[idx] : null;
}

/** Pace: scoring (and shots for soccer/hockey) relative to the league norm, per regulation. */
export function pace(tl, detail) {
  const game = detail.game;
  const p = RATING.leagues[game.league] || {};
  const last = tl.scores.filter((s) => s.t <= tl.progress + 1e-9).at(-1) || { hs: 0, as: 0 };
  const total = (last.hs || 0) + (last.as || 0);
  const elapsed = tl.final ? Math.max(1, tl.progress) : Math.max(0.25, tl.progress);
  let raw = p.totalNorm ? (total / elapsed) / p.totalNorm : 0;
  let shots = null;
  if (p.shotNorm) {
    if (detail.sport === 'hockey') shots = (detail.plays || []).filter((x) => x.onGoal).length;
    if (detail.sport === 'soccer') {
      const adv = detail.soccer?.advanced;
      shots = adv ? (adv.home?.totalShots || 0) + (adv.away?.totalShots || 0)
        : (detail.plays || []).filter((x) => /^shot-|goal/.test(x.type || '')).length;
    }
    if (shots != null && shots > 0) raw = 0.75 * raw + 0.25 * (shots / elapsed) / p.shotNorm;
  }
  return { raw, total, shots };
}

export { homeResult, plural };
