// Public rating API.
//
//   predict(game, cal)        -> predicted rating before the game (outlined badge)
//   rate(detail, cal, opts)   -> live or final rating from a GameDetail (filled badge)
//   predictF1 / rateF1        -> the F1 race (other F1 sessions are not rated)
//
// A Rating is: { state: 'predicted'|'live'|'final', value: 0..100, band: {key,label},
//   reasons: [{text, tone}], explain: string, components?, curve?, wp?, source? }

import RATING from '../../config/rating.js';
import { LEAGUE_BY_KEY } from '../core/leagues.js';
import { buildTimeline } from './timeline.js';
import { swing, swingFromBins, closeness, leadChanges, comeback, novelty, pace, homeResult } from './components.js';
import { contextFactors, priorRaw, stakesComponent } from './prior.js';
import { normalize, weighted, rawToRating, priorToRating, normalizeF1 } from './calibrate.js';
import { inGameReasons, pickReasons, joinReasons } from './explain.js';
import { measureF1, f1Reasons } from './f1.js';
import { predictGame, liveBlend } from '../predict/index.js';

export { getCalibration, setCalibration, prepareCalibration } from './calibrate.js';

export const ENGINE_VERSION = RATING.version;

/** Components shown as bars on the explanation sheet. */
const SHOWN = ['swing', 'closeness', 'leadChanges', 'comeback', 'novelty', 'pace', 'stakes', 'quality'];

export function bandOf(value) {
  const v = Math.round(value);
  return RATING.bands.find((b) => v >= b.min) || RATING.bands[RATING.bands.length - 1];
}

function finish(state, value, reasons, extra = {}) {
  const v = Math.max(0, Math.min(100, Math.round(value)));
  const picked = pickReasons(reasons, v);
  return {
    state,
    value: v,
    band: bandOf(v),
    reasons: picked.map(({ text, tone }) => ({ text, tone })),
    explain: joinReasons(picked),
    engine: ENGINE_VERSION,
    ...extra,
  };
}

/**
 * Predicted (pre-game) rating, from the pre-game model in js/predict (league base rate + terms,
 * range, P(Great)). `ctx` carries Elo / importance / injuries from data/predictions.json.
 */
export function predict(game, cal, ctx = {}) {
  if (game.sport === 'racing' && !game.isRace) return null;
  const p = predictGame(game, ctx);
  if (!p) return null;
  const value = p.value ?? Math.round(p.exact);
  return {
    state: 'predicted',
    value,
    band: bandOf(value),
    reasons: p.reasons.map(({ text, tone }) => ({ text, tone })),
    explain: p.explain,
    engine: ENGINE_VERSION,
    pred: p,
  };
}

/** Measure everything for a game detail (used by rate() and the backfill). */
export function measure(detail) {
  const tl = buildTimeline(detail);
  const game = detail.game;
  const lg = LEAGUE_BY_KEY[game.league];
  const live = game.state === 'in';
  const result = tl.final ? homeResult(game, tl.scores) : null;
  const late = RATING.lateWindow;
  const end = Math.max(tl.progress, 0);
  const start = tl.final ? Math.min(1 - late, end) : Math.max(0, end - late);
  const ctx = contextFactors(game, { pregameProb: tl.preProb });
  const scoresNow = tl.scores.filter((s) => s.t <= end + 1e-9);
  const lastScore = scoresNow.at(-1) || { hs: 0, as: 0 };
  const m = {
    timeline: tl,
    swing: swing(tl.points, end),
    closeness: closeness(tl.points, tl.scores, start, end, lg.oneScore ?? 1),
    leadChanges: leadChanges(tl.scores, end, live),
    comeback: comeback(tl.points, tl.scores, end, tl.final, result),
    novelty: novelty(tl, detail, result),
    pace: pace(tl, detail),
    context: ctx,
    stakes: stakesComponent(ctx),
    marginNow: lastScore.hs - lastScore.as,
    scores: scoresNow.length,
  };
  // Compact measurements: everything the components are derived from (cached by the backfill).
  m.base = {
    sw: m.swing.raw, swb: m.swing.bins.map((x) => Math.round(x * 10000) / 10000), el: m.swing.elapsed,
    cl: m.closeness.raw, lc: m.leadChanges.raw,
    cb: m.comeback.raw, cbT: m.timeline.final ? m.comeback.t : 1,
    nv: m.novelty.raw, pc: m.pace.raw,
    st: ctx.stakes, riv: ctx.rivalry, rk: ctx.ranked, q: ctx.quality,
  };
  m.raw = componentsFrom(m.base);
  m.priorRaw = priorRaw(ctx, game);
  return m;
}

/**
 * Raw component values from base measurements (see config/rating.js for the knobs):
 *   comeback  weighted by how late the winner's deepest hole came
 *   stakes    playoffs + rivalry + ranked matchup (scaled by competitiveness in normalize())
 *   quality   team quality from records / AP ranks (0.5 = average)
 */
export function componentsFrom(b) {
  const lateW = RATING.comebackLateness ?? 0.65;
  return {
    swing: b.swb ? swingFromBins(b.swb, b.el ?? 1, RATING.swingLateBoost || 0) : b.sw,
    // Win-probability movement in the final tenth of regulation plus overtime: a one-way late
    // comeback has modest total swing but a huge late one.
    lateSwing: b.swb ? (b.swb[9] || 0) + (b.swb[10] || 0) : null,
    closeness: b.cl,
    leadChanges: b.lc,
    comeback: b.cb * (1 - lateW + lateW * Math.min(1, Math.max(0, b.cbT ?? 1))),
    novelty: b.nv,
    pace: b.pc,
    stakes: Math.min(1, (b.st || 0) + 0.3 * (b.riv || 0) + 0.3 * (b.rk || 0)),
    quality: b.q ?? 0.5,
  };
}

/**
 * "Excitement intensity" curve for the game page: windowed win-probability swing plus
 * closeness, 0..100 at ~120 points across the game.
 */
export function excitementCurve(tl, scale) {
  const pts = tl.points;
  if (pts.length < 2) return [];
  const end = Math.max(tl.progress, 0.01);
  const n = 120;
  const win = 0.04;
  const out = [];
  let j = 0;
  for (let i = 0; i <= n; i++) {
    const t = (end * i) / n;
    while (j < pts.length - 1 && pts[j + 1].t <= t) j++;
    let s = 0;
    for (let k = j; k > 0 && pts[k].t > t - win; k--) s += Math.abs(pts[k].wp - pts[k - 1].wp);
    const rate = s / (win * (scale || 3));
    const wp = pts[j].wp;
    const close = 1 - Math.abs(wp - 0.5) * 2;
    const lateness = 0.55 + 0.45 * Math.min(1, t);
    out.push({ t, v: Math.min(1, 0.62 * Math.min(1, rate) + 0.38 * close * lateness) * 100 });
  }
  // Light smoothing.
  return out.map((p, i) => {
    const a = out[Math.max(0, i - 1)].v;
    const b = out[Math.min(out.length - 1, i + 1)].v;
    return { t: p.t, v: Math.round((a + 2 * p.v + b) / 4) };
  });
}

/** Downsample the win-probability series for charts. */
function wpSeries(tl, max = 240) {
  const pts = tl.points;
  if (pts.length <= max) return pts.map((p) => ({ t: +p.t.toFixed(4), wp: +p.wp.toFixed(3) }));
  const step = pts.length / max;
  const out = [];
  for (let i = 0; i < max; i++) {
    const p = pts[Math.floor(i * step)];
    out.push({ t: +p.t.toFixed(4), wp: +p.wp.toFixed(3) });
  }
  const last = pts[pts.length - 1];
  out.push({ t: +last.t.toFixed(4), wp: +last.wp.toFixed(3) });
  return out;
}

/**
 * Live or final rating from a GameDetail.
 * @param {object} detail
 * @param {object} cal calibration for the league (getCalibration)
 * @param {{predicted?: object}} [opts] predicted rating, used to blend while live
 */
export function rate(detail, cal, opts = {}) {
  const game = detail.game;
  if (game.sport === 'racing') return rateF1(detail, cal, opts);
  if (game.state === 'pre' || game.canceled) return predict(game, cal);
  const m = measure(detail);
  const norm = normalize(m.raw, cal?.scales || RATING.leagues[game.league]?.scales);
  const raw = weighted(norm, RATING.weights, RATING.amplifiers);
  const inGame = rawToRating(raw, cal);
  const live = game.state === 'in';
  const lg = LEAGUE_BY_KEY[game.league];
  const reasons = inGameReasons(m, norm, RATING.weights, {
    league: game.league, sport: lg.sport, final: m.timeline.final, live, context: m.context, game,
  });
  let value = inGame;
  let predicted = opts.predicted;
  if (live) {
    if (!predicted) predicted = predict(game, cal);
    // Live = w * Predicted + (1 - w) * Measured so far, w = (1 - progress)^2.
    value = liveBlend(predicted?.value ?? 50, inGame, m.timeline.progress);
    const a = 1 - (1 - Math.min(1, Math.max(0, m.timeline.progress))) ** 2;
    if (a < 0.5) {
      for (const r of predicted?.reasons || []) if (r.tone === '+') reasons.push({ ...r, score: 0.05 });
    }
  }
  return finish(live ? 'live' : 'final', value, reasons, {
    components: Object.fromEntries(SHOWN.filter((k) => norm[k] != null).map((k) => [k, +norm[k].toFixed(3)])),
    raw: +raw.toFixed(4),
    inGame: Math.round(inGame),
    source: m.timeline.source,
    progress: +m.timeline.progress.toFixed(3),
    curve: excitementCurve(m.timeline, cal?.scales?.swing),
    wp: wpSeries(m.timeline),
    scores: m.timeline.scores.map((s) => ({ t: +s.t.toFixed(4), hs: s.hs, as: s.as, side: s.side })),
  });
}

// ---------- F1 ----------

export function predictF1(game, cal, standings, ctx = {}) {
  return predict(game, cal, ctx);
}

export function rateF1(detail, cal, opts = {}) {
  const game = detail.game;
  if (!game.isRace) return null;
  const hasData = detail.f1?.laps?.length > 0;
  if (game.state === 'pre' || !hasData) {
    const pred = opts.predicted || predictF1(game, cal, detail.f1?.standings);
    // During the race without lap data we can only show the prediction.
    return pred ? { ...pred, state: game.state === 'post' ? 'predicted' : pred.state, pending: game.state !== 'pre' } : null;
  }
  const m = measureF1(detail);
  const norm = normalizeF1(m.raw, cal?.scales || RATING.f1.scales);
  const raw = weighted(norm, RATING.f1.weights);
  const value = rawToRating(raw, cal);
  return finish(game.state === 'in' ? 'live' : 'final', value, f1Reasons(m, norm), {
    components: Object.fromEntries(Object.entries(norm).map(([k, v]) => [k, +v.toFixed(3)])),
    raw: +raw.toFixed(4),
    facts: m.facts,
  });
}
