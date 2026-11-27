// Pre-game prediction: Predicted Excitement (objective) and Watch Priority (personal).
//
//   Raw       = Base_league + Σ terms                 (terms.js; blowout guard applied)
//   Predicted = Base + k × (Raw − Base), clipped 5..98
// After a backtest, a per-league ridge model in config/prediction.json `fitted` replaces the
// k-shrink (term contributions are rescaled so they sum to the model output), and per-league
// residual quantiles / logistic curves give the likely range and P(Great) / P(Dull).

import CFG from '../../config/prediction.json' with { type: 'json' };
import TEAMS from '../../config/teams.json' with { type: 'json' };
import RATING from '../../config/rating.js';
import { computeTerms, blowoutGuard, family } from './terms.js';
import { normCdf } from '../rating/wp.js';

export const PREDICTION_VERSION = CFG.version;

const GROUPS = ['closeness', 'quality', 'importance', 'stakes', 'style', 'narrative', 'availability', 'matchup', 'weather', 'total'];
/** Feature names for the regression (group points + continuous closeness). */
export const FEATURES = [...GROUPS, 'closeAbs', 'closeAbs2'];

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const sigmoid = (z) => 1 / (1 + Math.exp(-z));

export function isPlayoff(game) {
  return game.seasonType === 3 || !!game.tournament || /final|semifinal|quarterfinal|round-of|knockout|playoff/i.test(game.seasonSlug || '');
}

export function baseRate(game) {
  const b = CFG.base[game.league] || { regular: 50, playoff: 50 };
  return isPlayoff(game) ? b.playoff : b.regular;
}

/** Days from `now` (Pacific calendar days) until the game. */
export function daysOut(game, now = new Date()) {
  const start = new Date(game.start);
  if (!game.start || Number.isNaN(start.getTime())) return 0; // unknown kickoff: treat as today
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' });
  const a = new Date(`${fmt.format(now)}T12:00:00Z`);
  const b = new Date(`${fmt.format(start)}T12:00:00Z`);
  return Math.round((b - a) / 86400000);
}

export function horizonFor(days) {
  for (const h of CFG.horizons) if (days <= h.maxDays) return { ...h, days };
  return { key: 'circle', label: 'Circle this one', days };
}

/** Feature vector (fixed order, see FEATURES) from terms + matchup. */
export function featureVector(terms, m) {
  const g = Object.fromEntries(GROUPS.map((k) => [k, 0]));
  for (const t of terms) g[t.group] = (g[t.group] || 0) + t.points;
  // Continuous closeness: |p_fav − 0.5| (two-way); for soccer half the win-probability gap.
  let closeAbs = 0;
  if (m?.home != null) closeAbs = m.draw ? Math.abs(m.home - m.away) / 2 : Math.abs(Math.max(m.home, m.away) - 0.5);
  return [...GROUPS.map((k) => g[k]), closeAbs, closeAbs * closeAbs];
}

function fittedFor(league) {
  return CFG.fitted?.[league] || null;
}

/** Half-width of the likely range for a league, horizon and information source. */
export function rangeHalfWidth(league, horizonKey, source) {
  const f = fittedFor(league);
  const tier = f?.tiers?.[horizonKey];
  if (tier?.iqr) return tier.iqr / 2;
  const base = source === 'market' ? CFG.range.withOdds : CFG.range.eloOnly;
  return base * (CFG.range.horizonMultiplier[horizonKey] ?? 1.5);
}

/** P(Great) and P(Dull): logistic per league/tier after the backtest, else a normal approximation. */
export function bandProbabilities(league, horizonKey, value, half) {
  const f = fittedFor(league)?.tiers?.[horizonKey];
  if (f?.great && f?.dull) {
    return { pGreat: sigmoid(f.great[0] + f.great[1] * value), pDull: sigmoid(f.dull[0] + f.dull[1] * value) };
  }
  const sd = Math.max(4, half / 0.6745);
  return {
    pGreat: 1 - normCdf((CFG.great - 0.5 - value) / sd),
    pDull: normCdf((CFG.dull - 0.5 - value) / sd),
  };
}

function starOf(league, id) {
  return TEAMS.stars?.[league]?.[id]?.star || 0;
}

function isFavoriteTeam(game, favorites) {
  if (!game.home) return false;
  return (favorites || []).some((f) => f.leagues?.includes(game.league) && (String(f.id) === game.home.id || String(f.id) === game.away.id));
}

/** Watch Priority = Predicted + favorite bonus + star power / marquee (never shown as the badge). */
export function watchPriority(game, value, { favorites = [] } = {}) {
  const parts = [];
  if (isFavoriteTeam(game, favorites)) parts.push({ label: 'Favorite', points: CFG.priority.favorite });
  const cap = CFG.priority.starMax; // the addendum's 0-4 for star power or marquee appeal
  let star = Math.max(starOf(game.league, game.home?.id), starOf(game.league, game.away?.id));
  if (/super bowl|world series|finals|national championship/i.test((game.notes || []).join(' '))) star = Math.max(star, 3);
  if (star) parts.push({ label: 'Star power', points: Math.min(cap, star) });
  return { value: Math.round((value ?? 50) + parts.reduce((s, p) => s + p.points, 0)), parts };
}

/** Rule-based "Circle this one" flags; flagged when two or more apply. */
export function circleFlags(game, ctx = {}, { favorites = [] } = {}) {
  const reasons = [];
  const lgCollege = /cfb|mcbb|wcbb/.test(game.league);
  const p = ctx.eloPct;
  if (lgCollege) {
    if (game.home?.rank && game.away?.rank && game.home.rank <= 10 && game.away.rank <= 10) reasons.push('Both AP top 10');
  } else if (p && p.home >= 0.8 && p.away >= 0.8) reasons.push('Two top-20% teams');
  if (ctx.importancePct != null && ctx.importancePct >= 0.9) reasons.push('Big standings stakes');
  const pairs = RATING.rivalries[game.league] || [];
  if (game.home && pairs.some(([x, y]) => (x === game.home.id && y === game.away.id) || (x === game.away.id && y === game.home.id))) reasons.push('Rivalry');
  if (isFavoriteTeam(game, favorites) && p) {
    const favHome = favorites.some((f) => f.leagues?.includes(game.league) && String(f.id) === game.home.id);
    const opp = favHome ? p.away : p.home;
    if (opp >= 0.67) reasons.push('Favorite vs a quality opponent');
  }
  const notes = (game.notes || []).join(' ');
  const d = new Date(game.start);
  const md = `${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  if (game.league === 'cfb' && md >= '11-24' && md <= '12-01') reasons.push('Rivalry week');
  if (game.league === 'nba' && md === '12-25') reasons.push('Christmas Day');
  if (/2nd leg|second leg/i.test(notes) && /ucl|uel/.test(game.league)) reasons.push('Knockout second leg');
  if (game.league === 'f1' && game.isRace && /Interlagos|Silverstone|Americas|Austin|Red Bull Ring|Spielberg/i.test(`${game.circuit} ${game.gpName}`)) reasons.push('Marquee circuit');
  return { flagged: reasons.length >= 2, reasons };
}

function reasonsFrom(terms) {
  const pos = terms.filter((t) => t.points > 0.4 && t.text).sort((a, b) => b.points - a.points).slice(0, 3);
  const neg = terms.filter((t) => t.points < -0.4 && t.text).sort((a, b) => a.points - b.points).slice(0, 1);
  return [...pos.map((t) => ({ text: t.text, tone: '+', points: t.points })), ...neg.map((t) => ({ text: t.text, tone: '-', points: t.points }))];
}

/**
 * Predict a game.
 * @param {object} game  normalized Game (adapters) - home/away/odds/notes/series/start...
 * @param {object} [ctx] { elo:{home,away}, eloPct:{home,away}, importance, importancePct, extras,
 *                         structure:{home,away}, style:{home,away}, leagueSize, now, favorites }
 */
export function predictGame(input, ctx = {}) {
  const game = pregameView(input);
  const now = ctx.now || new Date();
  const days = daysOut(game, now);
  const horizon = horizonFor(Math.max(0, days));
  const base = baseRate(game);
  if (game.sport === 'racing' && !game.isRace) return null;

  const { terms, matchup: m, closeness } = computeTerms(game, ctx);
  const guard = blowoutGuard(terms, closeness);
  const x = featureVector(terms, m);
  const fit = ctx.rulesOnly ? null : fittedFor(game.league);
  let value;
  let contrib;
  if (fit?.model === 'fitted' && fit?.coef?.length === FEATURES.length) {
    // Ridge model on the same features; scale each term so contributions sum to the output.
    const groupContrib = {};
    let sum = fit.intercept;
    FEATURES.forEach((f, i) => {
      const c = fit.coef[i] * x[i];
      sum += c;
      const g = f.startsWith('close') ? 'closeness' : f;
      groupContrib[g] = (groupContrib[g] || 0) + c;
    });
    value = sum;
    contrib = terms.map((t) => {
      const groupPts = terms.filter((u) => u.group === t.group).reduce((s, u) => s + u.points, 0);
      const share = groupPts ? t.points / groupPts : 0;
      return { ...t, points: Math.round((groupContrib[t.group] || 0) * share * 10) / 10 };
    });
  } else {
    const k = fit?.k ?? CFG.k;
    const raw = base + terms.reduce((s, t) => s + t.points, 0);
    value = base + k * (raw - base);
    contrib = terms.map((t) => ({ ...t, points: Math.round(t.points * k * 10) / 10 }));
  }
  value = clamp(value, CFG.clip[0], CFG.clip[1]);
  const half = rangeHalfWidth(game.league, horizon.key, m.source);
  const { pGreat, pDull } = bandProbabilities(game.league, horizon.key, value, half);
  const display = horizon.roundTo ? Math.round(value / horizon.roundTo) * horizon.roundTo : Math.round(value);
  const reasons = reasonsFrom(contrib);
  if (guard.applied) reasons.push({ text: 'Blowout risk outweighs the stakes', tone: '-', points: 0 });
  const priority = watchPriority(game, value, { favorites: ctx.favorites });
  return {
    value: horizon.key === 'circle' ? null : display,
    exact: Math.round(value * 10) / 10,
    low: Math.round(clamp(value - half, 0, 100)),
    high: Math.round(clamp(value + half, 0, 100)),
    pGreat: Math.round(pGreat * 1000) / 1000,
    pDull: Math.round(pDull * 1000) / 1000,
    horizon,
    base,
    source: m.source,
    probs: m.home != null ? { home: round3(m.home), away: round3(m.away), draw: round3(m.draw || 0) } : null,
    terms: contrib.filter((t) => t.text || t.points),
    reasons,
    explain: reasons.map((r) => r.text).join(' · '),
    features: x,
    guard: guard.applied,
    priority: priority.value,
    priorityParts: priority.parts,
    circle: circleFlags(game, ctx, { favorites: ctx.favorites }),
    model: fit?.model === 'fitted' && fit?.coef ? 'fitted' : 'rules',
    version: PREDICTION_VERSION,
  };
}

function round3(x) {
  return x == null ? null : Math.round(x * 1000) / 1000;
}

/**
 * The only view of a game the predictor may see: fields known before kickoff. Scores, winners,
 * status, clocks, live situations, plays and post-game records are dropped. ESPN reports series
 * records (and soccer aggregates) after the game is included, so this game's result is backed out.
 */
export function pregameView(game) {
  const done = game.state === 'post' && !game.canceled;
  let series = null;
  const s = game.series;
  if (s) {
    if (s.kind === 'aggregate') {
      const played = done && game.home?.score != null && game.away?.score != null;
      series = {
        kind: 'aggregate',
        homeAgg: s.homeAgg != null ? s.homeAgg - (played ? game.home.score : 0) : null,
        awayAgg: s.awayAgg != null ? s.awayAgg - (played ? game.away.score : 0) : null,
      };
    } else if (s.homeWins != null) {
      let h = s.homeWins;
      let a = s.awayWins;
      if (done) {
        const hw = game.home?.winner || (game.home?.score > game.away?.score);
        const aw = game.away?.winner || (game.away?.score > game.home?.score);
        if (hw) h = Math.max(0, h - 1); else if (aw) a = Math.max(0, a - 1);
      }
      series = { homeWins: h, awayWins: a, total: s.total, toWin: s.toWin ?? (s.total ? Math.floor(s.total / 2) + 1 : null) };
    }
  }
  const team = (t) => t && ({ id: t.id, abbr: t.abbr, short: t.short, name: t.name, rank: t.rank ?? null, color: t.color, logo: t.logo, probable: t.probable ?? null });
  return {
    key: game.key, id: game.id, league: game.league, sport: game.sport, start: game.start, state: 'pre',
    notes: game.notes || [], seasonType: game.seasonType, seasonSlug: game.seasonSlug || '',
    neutral: !!game.neutral, conferenceGame: !!game.conferenceGame, tournament: !!game.tournament,
    broadcasts: game.broadcasts || [], venue: game.venue || '', indoor: game.indoor ?? null, weather: game.weather ?? null,
    odds: game.odds || null, series,
    home: team(game.home), away: team(game.away),
    // F1
    isRace: game.isRace, circuit: game.circuit, gpName: game.gpName, session: game.session,
  };
}

/**
 * Live display: blend the prediction with the measured partial-game rating.
 *   Live = w × Predicted + (1 − w) × Measured,  w = (1 − progress)²
 */
export function liveBlend(predicted, measured, progress) {
  const p = clamp(progress, 0, 1);
  const w = (1 - p) ** 2;
  return w * predicted + (1 - w) * measured;
}

/** Plain-language summary line used by cards: "Predicted 74 (likely 63–84) · 22% chance of Great". */
export function predictionLine(pred) {
  if (!pred || pred.value == null) return '';
  return `Predicted ${pred.value} (likely ${pred.low}–${pred.high}) · ${Math.round(pred.pGreat * 100)}% chance of Great`;
}
