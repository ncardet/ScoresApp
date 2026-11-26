// Turns a GameDetail into the series the rating engine measures:
//   points: [{t, wp, hs, as}]  home win probability over game time t (0..1 regulation, >1 overtime)
//   scores: [{t, hs, as, side}] every score change, starting at 0-0
// ESPN's per-play win probability is used when present; otherwise a fallback model from wp.js
// is evaluated on a fine time grid plus every score change.

import RATING from '../../config/rating.js';
import { LEAGUE_BY_KEY } from '../core/leagues.js';
import { clockT, baseballT } from '../core/gametime.js';
import { marginWp, driftFromProb, splitRates, soccerWp, hockeyWp, runsWp } from './wp.js';

/** Score changes, starting with 0-0 at t = 0. */
export function scoreSeries(detail) {
  const out = [{ t: 0, hs: 0, as: 0, side: null }];
  if (detail.sport === 'soccer') {
    for (const g of detail.soccer?.goals || []) {
      out.push({ t: g.t, hs: g.hs, as: g.as, side: g.side, who: g.athlete, type: g.type, clock: g.clock });
    }
    return out;
  }
  let hs = 0;
  let as = 0;
  for (const p of detail.plays || []) {
    if (p.hs == null || p.as == null) continue;
    if (p.shootout) continue; // shootout attempts are not goals
    if (p.hs !== hs || p.as !== as) {
      const side = p.hs > hs ? 'home' : p.as > as ? 'away' : null;
      hs = p.hs;
      as = p.as;
      out.push({ t: p.t, hs, as, side, who: p.athlete, period: p.period, clock: p.clock, half: p.half });
    }
  }
  return out;
}

/** Current game time t for a live game, from its status line. */
export function progressFromStatus(game) {
  const lg = LEAGUE_BY_KEY[game.league];
  if (!lg || game.state === 'pre') return 0;
  if (game.state === 'post') return 1;
  switch (lg.sport) {
    case 'soccer': {
      const m = String(game.clock || game.detail || '').match(/(\d+)/);
      if (/half/i.test(game.detail || '') && !m) return 0.5;
      const min = m ? +m[1] : 0;
      return min <= 90 ? min / 90 : 1 + (min - 90) / 90;
    }
    case 'baseball': {
      const d = String(game.detail || '');
      const half = /^(bot|bottom|end)/i.test(d) ? 'bottom' : 'top';
      const outs = /^(mid|end)/i.test(d) ? 3 : game.live?.baseball?.outs ?? 0;
      return baseballT(game.period || 1, half, outs);
    }
    case 'racing':
      return 0;
    default:
      if (/half/i.test(game.detail || '') && lg.periods === 4) return 0.5;
      return clockT(lg, game.period || 1, game.clock, { clockMode: 'remaining' });
  }
}

function lastOf(arr) {
  return arr[arr.length - 1];
}

/** Final result for the home team: 1 win, 0 loss, 0.5 draw/unknown. */
function homeResult(game, scores) {
  if (game.home?.winner) return 1;
  if (game.away?.winner) return 0;
  const last = lastOf(scores);
  const hs = game.home?.score ?? last.hs;
  const as = game.away?.score ?? last.as;
  if (hs > as) return 1;
  if (as > hs) return 0;
  return 0.5;
}

function scoreAt(scores, t) {
  let s = scores[0];
  for (const x of scores) {
    if (x.t <= t + 1e-9) s = x; else break;
  }
  return s;
}

/** Pre-game home win probability: odds, ESPN predictor, or ESPN's first win-probability point. */
export function pregameHomeProb(detail) {
  const o = detail.odds || detail.game?.odds;
  if (o?.home != null && o?.away != null) {
    // Two-way equivalent for margin models (split the draw).
    return o.draw != null ? o.home + o.draw / 2 : o.home;
  }
  if (detail.predictor?.home) return detail.predictor.home;
  if (detail.wp?.length) return detail.wp[0].wp;
  return null;
}

function maxT(detail, scores, game) {
  let t = 0;
  for (const p of detail.plays || []) if (p.t > t && !p.shootout) t = p.t;
  for (const s of scores) if (s.t > t) t = s.t;
  if (detail.wp?.length) t = Math.max(t, lastOf(detail.wp).t);
  return t;
}

function espnPoints(detail, scores, progress, final, game) {
  const pts = detail.wp.map((w) => ({ t: w.t, wp: w.wp }));
  if (pts[0].t > 0.001) pts.unshift({ t: 0, wp: pts[0].wp });
  if (final) {
    const r = homeResult(game, scores);
    const last = lastOf(pts);
    if (Math.abs(last.wp - r) > 0.001) pts.push({ t: Math.max(progress, last.t), wp: r });
  }
  return pts;
}

/** Regulation time remaining (in regulation units) for the overtime-aware margin/poisson models. */
function remaining(t, lg, game) {
  if (t < 1) return 1 - t;
  // Overtime: time left in the current OT period, in units of regulation.
  const playoffHockey = lg.sport === 'hockey' && game.seasonType === 3;
  const otMin = lg.sport === 'soccer' ? 30 : playoffHockey ? 20 : lg.otMinutes || 5;
  const regMin = lg.periods * lg.periodMinutes;
  const ot = otMin / regMin;
  const k = Math.floor((t - 1) / ot + 1e-9);
  return Math.max(0, 1 + (k + 1) * ot - t);
}

function modelPoints(detail, scores, progress, final, game, preProb) {
  const lg = LEAGUE_BY_KEY[game.league];
  const p = RATING.leagues[game.league] || {};
  const sport = lg.sport;
  const odds = detail.odds || game.odds;
  let wpAt;
  if (sport === 'soccer') {
    const rates = splitRates(p.goalsPerGame || 2.8, odds?.home, odds?.away);
    wpAt = (t, s) => soccerWp(s.hs - s.as, t < 1 ? 1 - t : remaining(t, lg, game), rates, 0.5);
  } else if (sport === 'hockey') {
    const pr = preProb ?? 0.53;
    const rates = splitRates((p.goalsPerTeam || 3.1) * 2, pr, 1 - pr);
    const otHome = RATING.sports.hockey.otHomeEdge;
    wpAt = (t, s) => {
      if (t >= 1) {
        // Overtime is sudden death; tied => roughly a coin flip with a small home edge.
        const d = s.hs - s.as;
        return d > 0 ? 1 : d < 0 ? 0 : otHome;
      }
      return hockeyWp(s.hs - s.as, 1 - t, rates, otHome);
    };
  } else if (sport === 'baseball') {
    const drift = driftFromProb(preProb ?? 0.54, 4.4);
    wpAt = (t, s) => {
      const fr = t < 1 ? 1 - t : Math.max(1 / 54, (1 + Math.ceil((t - 1) * 9 + 1e-9) / 9) - t);
      return runsWp(s.hs - s.as, fr, 4.4, drift);
    };
  } else {
    const sigma = p.sigma || 12;
    const drift = driftFromProb(preProb ?? 0.55, sigma);
    wpAt = (t, s) => marginWp(s.hs - s.as, remaining(t, lg, game), sigma, drift);
  }

  const end = Math.max(progress, 0);
  const step = 1 / 180;
  const times = new Set();
  for (let t = 0; t <= end + 1e-9; t += step) times.add(+t.toFixed(5));
  for (const s of scores) if (s.t <= end + 1e-9) times.add(+s.t.toFixed(5));
  times.add(+end.toFixed(5));
  const sorted = [...times].sort((a, b) => a - b);
  const pts = sorted.map((t) => {
    const s = scoreAt(scores, t);
    return { t, wp: wpAt(t, s) };
  });
  if (final) {
    const r = homeResult(game, scores);
    pts.push({ t: end, wp: r });
  }
  return pts;
}

/**
 * @param {object} detail GameDetail from an adapter
 * @returns {{points: {t:number, wp:number, hs:number, as:number}[], scores: object[], progress: number,
 *   final: boolean, source: 'espn'|'model', league: string, sport: string, preProb: number|null}}
 */
export function buildTimeline(detail) {
  const game = detail.game;
  const lg = LEAGUE_BY_KEY[game.league];
  const final = game.state === 'post' && !game.canceled;
  const scores = scoreSeries(detail);
  const lastT = maxT(detail, scores, game);
  let progress;
  if (final) progress = Math.max(1, lastT);
  else if (game.state === 'in') progress = Math.max(lastT, Math.min(progressFromStatus(game), lastT + 0.05));
  else progress = 0;

  const preProb = pregameHomeProb(detail);
  const useEspn = detail.wp && detail.wp.length >= 10;
  const raw = useEspn
    ? espnPoints(detail, scores, progress, final, game)
    : modelPoints(detail, scores, progress, final, game, preProb);
  const points = raw.map((pt) => {
    const s = scoreAt(scores, pt.t);
    return { t: pt.t, wp: pt.wp, hs: s.hs, as: s.as };
  });
  return {
    points,
    scores,
    progress,
    final,
    source: useEspn ? 'espn' : 'model',
    league: lg.key,
    sport: lg.sport,
    preProb: preProb ?? (points[0]?.wp ?? null),
  };
}
