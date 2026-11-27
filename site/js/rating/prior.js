// Context prior: what we know before kickoff. Drives the predicted rating and the in-game
// "stakes" component. Every factor is 0..1 and comes with a plain-English reason.
//
//   closeness  matchup closeness from betting odds, else from team records (log5)
//   quality    combined team quality (records / AP rank)
//   rivalry    configured rivalry (1) or conference game (0.3)
//   stakes     playoffs / elimination / winner-take-all / finals
//   ranked     college: ranked vs ranked
// Favorites are NOT part of the rating number: they only boost ordering on the home screen.

import RATING from '../../config/rating.js';
import { LEAGUE_BY_KEY } from '../core/leagues.js';

/** Parse a record string into a 0..1 strength. */
export function recordStrength(record, sport) {
  const parts = String(record || '').split(/[-–]/).map((x) => parseInt(x, 10));
  if (parts.length < 2 || parts.some((x) => !Number.isFinite(x))) return null;
  if (sport === 'soccer') {
    const [w, d, l] = parts.length >= 3 ? parts : [parts[0], 0, parts[1]];
    const gp = w + d + l;
    return gp ? (3 * w + d) / (3 * gp) : null;
  }
  if (sport === 'hockey') {
    const [w, l, otl = 0] = parts;
    const gp = w + l + otl;
    return gp ? (2 * w + otl) / (2 * gp) : null;
  }
  const [w, l, t = 0] = parts;
  const gp = w + l + t;
  return gp ? (w + 0.5 * t) / gp : null;
}

function gamesPlayed(record) {
  const parts = String(record || '').split(/[-–]/).map((x) => parseInt(x, 10)).filter(Number.isFinite);
  return parts.reduce((a, b) => a + b, 0);
}

/** log5 probability that A beats B given strengths. */
function log5(a, b) {
  const den = a + b - 2 * a * b;
  return den ? (a - a * b) / den : 0.5;
}

const KO = /\bfinals?\b|semifinal|quarterfinal|round of|knockout|play-?offs?|wild ?card|divisional|championship|super bowl|world series|stanley cup|\bbowl\b|\bleg\b|elimination/i;
const KO_SLUG = /final|semifinal|quarterfinal|round-of|knockout|playoff/i;
const FINAL = /\b(finals?|championship|super bowl|world series|stanley cup final|national championship|mls cup|title)\b/i;

/** Series wins before this game (ESPN's series record already includes a finished game). */
function seriesBefore(game) {
  const s = game.series;
  if (!s || s.homeWins == null || s.awayWins == null) return null;
  let h = s.homeWins;
  let a = s.awayWins;
  if (game.state === 'post' && !game.canceled) {
    if (game.home?.winner) h = Math.max(0, h - 1);
    else if (game.away?.winner) a = Math.max(0, a - 1);
  }
  return { h, a, toWin: s.toWin };
}

/** Stakes 0..1 with a label. */
export function stakesFactor(game) {
  const notes = (game.notes || []).join(' · ');
  // An in-season cup final: real stakes, but not a playoff game.
  if (/commissioner'?s cup/i.test(notes)) return { value: 0.5, label: "Commissioner's Cup Championship" };
  const knockoutSoccer = game.sport === 'soccer' && KO_SLUG.test(game.seasonSlug || '');
  const post = game.seasonType === 3 || game.tournament || knockoutSoccer || (KO.test(notes) && !/regular season|group|league phase/i.test(notes));
  if (!post) return { value: 0, label: '' };
  let value = 0.5;
  let label = notes.split(' · ')[0] || 'Playoffs';
  const sb = seriesBefore(game);
  const gameN = notes.match(/Game (\d+)/i);
  if (sb && sb.toWin) {
    const need = sb.toWin - 1;
    const hElim = sb.a === need;
    const aElim = sb.h === need;
    if (hElim && aElim) { value = 1; label = `${notes.split(' · ')[0] || `Game ${sb.h + sb.a + 1}`}: winner takes the series`; }
    else if (hElim || aElim) { value = 0.8; label = `Elimination game (${notes.split(' · ')[0] || 'playoffs'})`; }
  } else if (gameN && /Game 7/i.test(notes)) {
    value = 1;
  } else if (/2nd leg|second leg/i.test(notes)) {
    value = 0.8;
  } else if (/1st leg|first leg/i.test(notes)) {
    value = 0.5;
  } else if (game.sport === 'football' || game.tournament || /single|bowl|final|semifinal|quarterfinal|round of/i.test(notes)) {
    value = 0.8; // single elimination
  }
  if (FINAL.test(notes) && !/semi|quarter|conference final(?!s)/i.test(notes)) value = Math.min(1, value + 0.2);
  return { value, label };
}

function rivalry(game) {
  const pairs = RATING.rivalries[game.league] || [];
  const h = game.home?.id;
  const a = game.away?.id;
  if (pairs.some(([x, y]) => (x === h && y === a) || (x === a && y === h))) return { value: 1, label: 'Rivalry' };
  if (game.conferenceGame && LEAGUE_BY_KEY[game.league]?.college) return { value: 0.3, label: '' };
  return { value: 0, label: '' };
}

function rankedFactor(game) {
  const hr = game.home?.rank;
  const ar = game.away?.rank;
  if (hr && ar) {
    const top10 = hr <= 10 && ar <= 10;
    return { value: top10 ? 1 : 0.6, label: `No. ${Math.min(hr, ar)} vs No. ${Math.max(hr, ar)}` };
  }
  if (hr || ar) return { value: 0.25, label: '' };
  return { value: 0, label: '' };
}

/**
 * Pre-game probabilities {home, away, draw} from odds or records.
 * `pregameProb` (e.g. ESPN's first win-probability point) wins when given.
 */
export function matchupProbs(game, pregameProb) {
  const o = game.odds;
  if (o?.home != null && o?.away != null) return { home: o.home, away: o.away, draw: o.draw ?? null, source: 'odds', spread: o.spread };
  if (pregameProb != null) return { home: pregameProb, away: 1 - pregameProb, draw: null, source: 'model' };
  const lg = LEAGUE_BY_KEY[game.league];
  const sh = recordStrength(game.home?.record, lg.sport);
  const sa = recordStrength(game.away?.record, lg.sport);
  if (sh == null || sa == null || gamesPlayed(game.home?.record) < 2 || gamesPlayed(game.away?.record) < 2) return null;
  const clamp = (x) => Math.min(0.95, Math.max(0.05, x));
  let p = log5(clamp(sh), clamp(sa));
  if (!game.neutral) p = Math.min(0.97, p + 0.04);
  if (lg.sport === 'soccer') {
    const draw = 0.26;
    return { home: p * (1 - draw), away: (1 - p) * (1 - draw), draw, source: 'records' };
  }
  return { home: p, away: 1 - p, draw: null, source: 'records' };
}

/**
 * All context factors for a game.
 * @returns {{closeness:number, quality:number, rivalry:number, stakes:number, ranked:number,
 *   probs: object|null, reasons: {key:string, text:string, value:number}[]}}
 */
export function contextFactors(game, { pregameProb } = {}) {
  const lg = LEAGUE_BY_KEY[game.league];
  const reasons = [];
  const probs = matchupProbs(game, pregameProb);
  let closeness = 0.55;
  if (probs) {
    const decisive = probs.home + probs.away;
    closeness = decisive > 0 ? 1 - Math.abs(probs.home - probs.away) / decisive : 0.55;
    if (probs.source === 'odds' && probs.spread != null && ['football', 'basketball'].includes(lg.sport)) {
      const sp = Math.abs(probs.spread);
      if (sp <= 3) reasons.push({ key: 'closeness', text: sp === 0 ? 'Pick\'em by the odds' : `Projected within ${fmtNum(sp)} points`, value: closeness });
      else if (sp >= 10) reasons.push({ key: 'closeness', text: `${fmtNum(sp)}-point favorite: likely one-sided`, value: closeness, tone: '-' });
    } else if (closeness >= 0.8) {
      reasons.push({ key: 'closeness', text: probs.source === 'odds' ? 'Evenly matched by the odds' : 'Evenly matched on record', value: closeness });
    } else if (closeness <= 0.35) {
      reasons.push({ key: 'closeness', text: 'Lopsided matchup on paper', value: closeness, tone: '-' });
    }
  }

  // Records mean little in the first few games of a season: require 4+ games played.
  const sh = gamesPlayed(game.home?.record) >= 4 ? recordStrength(game.home?.record, lg.sport) : null;
  const sa = gamesPlayed(game.away?.record) >= 4 ? recordStrength(game.away?.record, lg.sport) : null;
  let quality = 0.5;
  const strengths = [sh, sa].map((s, i) => {
    const rank = (i === 0 ? game.home : game.away)?.rank;
    const rankS = rank ? 0.75 + (26 - rank) / 100 : null;
    if (s == null) return rankS ?? 0.5;
    return rankS ? Math.max(s, rankS) : s;
  });
  if (strengths.length === 2) {
    const mean = (strengths[0] + strengths[1]) / 2;
    const min = Math.min(...strengths);
    quality = Math.min(1, Math.max(0, 0.5 * mean + 0.5 * min));
    // Rescale: 0.5 (average teams) -> 0.5, 0.75+ (two strong teams) -> 1.
    quality = Math.min(1, Math.max(0, (quality - 0.25) / 0.5));
    const good = lg.sport === 'soccer' ? 0.6 : 0.62;
    if (sh != null && sa != null && sh >= good && sa >= good && gamesPlayed(game.home.record) >= 4) {
      reasons.push({ key: 'quality', text: 'Two of the better teams', value: quality });
    }
  }

  const riv = rivalry(game);
  if (riv.label) reasons.push({ key: 'rivalry', text: riv.label, value: riv.value });
  const st = stakesFactor(game);
  if (st.value > 0) reasons.push({ key: 'stakes', text: st.label, value: st.value });
  const rk = lg.college ? rankedFactor(game) : { value: 0, label: '' };
  if (rk.label) reasons.push({ key: 'ranked', text: rk.value >= 1 ? `Top-10 matchup (${rk.label})` : `Ranked matchup (${rk.label})`, value: rk.value });

  return { closeness, quality, rivalry: riv.value, stakes: st.value, ranked: rk.value, probs, reasons };
}

function fmtNum(x) {
  return Number.isInteger(x) ? String(x) : x.toFixed(1);
}

/** Weighted prior raw score 0..1. */
export function priorRaw(f, game) {
  const w = { ...RATING.prior.weights };
  if (!LEAGUE_BY_KEY[game.league]?.college) delete w.ranked;
  let sum = 0;
  let tot = 0;
  for (const [k, wk] of Object.entries(w)) {
    sum += wk * (f[k] ?? 0);
    tot += wk;
  }
  return tot ? sum / tot : 0.5;
}

/** In-game stakes component (playoffs, rivalry, ranked matchup), 0..1. */
export function stakesComponent(f) {
  return Math.min(1, f.stakes + 0.3 * f.rivalry + 0.3 * f.ranked);
}
