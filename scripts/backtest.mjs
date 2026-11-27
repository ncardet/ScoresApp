#!/usr/bin/env node
// Walk-forward backtest of the pre-game model, per league and horizon tier.
//
//   1. Recalibrates post-game ratings from every backfilled game (site/data/calibration).
//   2. Rebuilds Elo, standings and season simulations AS OF each game date (point-in-time),
//      for three horizons: 0-2 days (closing line when ESPN kept one), 5 days and 11 days out.
//   3. Fits per-league ridge regressions (and logistic P(Great) / P(Dull)), training only on
//      seasons before the one tested.
//   4. Writes reports/backtest.md and refits config/prediction.json.
//
//   node scripts/backtest.mjs [--leagues nba,epl] [--sims 1500] [--no-write]
// Needs .cache/history and .cache/targets (scripts/backfill-targets.mjs).

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import CFG from '../site/config/prediction.json' with { type: 'json' };
import RATING from '../site/config/rating.js';
import { leagueHistory, SEASONS } from './lib/history.mjs';
import { walk } from './lib/elo-walk.mjs';
import { leagueStructure } from './lib/structure.mjs';
import { simulateSeason, standingsFrom, FORMATS } from '../site/js/predict/simulate.js';
import { predictGame, FEATURES, isPlayoff } from '../site/js/predict/index.js';
import { circuitAverage } from '../site/js/predict/terms.js';
import { championshipStakes } from '../site/js/rating/f1.js';
import { prepareCalibration, rawToRating, normalize, weighted, normalizeF1, COMPONENTS, F1_COMPONENTS } from '../site/js/rating/calibrate.js';
import { addDays } from '../site/js/core/time.js';
import { getJson } from '../site/js/adapters/espn/client.js';
import { parseStandings } from '../site/js/adapters/espn/standings.js';
import { displayable, toGame, TARGET_DIR } from './backfill-targets.mjs';
import { ridge, predictLinear, logistic1, spearman, auc, mean, median, quantile } from './lib/stats.mjs';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, arr) => {
  if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true]);
  return acc;
}, []));
const LEAGUE_KEYS = args.leagues ? String(args.leagues).split(',') : [...Object.keys(SEASONS), 'f1'];
const SIMS = +args.sims || 1500;
const WRITE = !args['no-write'];
const LAMBDA = 3; // strong shrinkage: few training seasons, noisy target
export const TIERS = [
  { key: 'prediction', offset: 0, label: '0-2 days' },
  { key: 'forecast', offset: 5, label: '3-7 days' },
  { key: 'early', offset: 11, label: '8-14 days' },
];
const CLOSE_IDX = ['closeness', 'closeAbs', 'closeAbs2'].map((f) => FEATURES.indexOf(f));
const QI_IDX = ['quality', 'importance'].map((f) => FEATURES.indexOf(f));
const r1 = (x) => (Number.isFinite(x) ? Math.round(x * 10) / 10 : null);
const r3 = (x) => (Number.isFinite(x) ? Math.round(x * 1000) / 1000 : null);

async function readJson(file, fallback = null) {
  try { return JSON.parse(await readFile(file, 'utf8')); } catch { return fallback; }
}

/** Deterministic sample of n items. */
function sample(arr, n, seed = 7) {
  if (arr.length <= n) return arr;
  const a = [...arr];
  let s = seed;
  const rand = () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a.slice(0, n);
}

/** Week bucket (Tue-Mon) for football's "within-week" comparisons. */
function groupKey(league, day) {
  if (league !== 'nfl' && league !== 'cfb') return day;
  const d = new Date(`${day}T12:00:00Z`);
  const shifted = new Date(d.getTime() - ((d.getUTCDay() + 5) % 7) * 86400000);
  return shifted.toISOString().slice(0, 10);
}

// ---------------- data assembly ----------------

async function teamLeagueRows(league) {
  const cfg = SEASONS[league];
  const pool = CFG.elo[league]?.pool;
  const histories = await leagueHistory(league);
  const poolHist = pool ? [...histories, ...(await leagueHistory(league === 'ucl' ? 'uel' : 'ucl'))] : histories;
  const structure = await leagueStructure(league);
  const book = walk(league, poolHist);

  // Targets + recalibration from every backfilled game.
  const targets = {};
  for (const s of cfg.eval) targets[s] = await readJson(join(TARGET_DIR, league, `${s}.json`), {});
  const rawRows = Object.values(targets).flatMap((t) => Object.values(t).filter((v) => v.raw).map((v) => v.raw));
  if (rawRows.length < 50) return { league, rows: [], note: 'not enough backfilled games' };
  const calFile = {
    league, engine: RATING.version, generated: new Date().toISOString(), window: `seasons ${cfg.eval.join(', ')} (backfill)`,
    n: Math.min(rawRows.length, 900), columns: COMPONENTS, rows: sample(rawRows, 900),
  };
  if (WRITE) await writeFile(`site/data/calibration/${league}.json`, JSON.stringify(calFile));
  const cal = prepareCalibration(calFile, league);
  const actual = (raw) => rawToRating(weighted(normalize(Object.fromEntries(COMPONENTS.map((c, i) => [c, raw[i]])), cal.scales), RATING.weights), cal);

  // Point-in-time helpers.
  const pctCache = new Map();
  const seasonTeams = new Map(histories.map((h) => [h.season, new Set(h.games.flatMap((g) => [g.h.id, g.a.id]))]));
  const percentiles = (season, day) => {
    const key = `${season}|${day}`;
    if (pctCache.has(key)) return pctCache.get(key);
    const ids = [...(seasonTeams.get(season) || [])];
    const vals = ids.map((id) => [id, book.asOf(id, day)]).sort((a, b) => a[1] - b[1]);
    const m = new Map(vals.map(([id], i) => [id, (i + 1) / vals.length]));
    pctCache.set(key, m);
    return m;
  };
  const styleAt = (seasonGames, day) => {
    if (league !== 'nba') return null;
    const tot = new Map();
    for (const g of seasonGames) {
      if (g.day >= day || !g.done) break;
      const t = (g.h.s ?? 0) + (g.a.s ?? 0);
      for (const id of [g.h.id, g.a.id]) { const v = tot.get(id) || [0, 0]; v[0] += t; v[1]++; tot.set(id, v); }
    }
    const avgs = [...tot.entries()].filter(([, v]) => v[1] >= 5).map(([id, v]) => [id, v[0] / v[1]]);
    if (avgs.length < 10) return null;
    const m = mean(avgs.map((x) => x[1]));
    const sd = Math.sqrt(mean(avgs.map((x) => (x[1] - m) ** 2))) || 1;
    return new Map(avgs.map(([id, v]) => [id, (v - m) / sd]));
  };

  // Importance from weekly simulation checkpoints (regular season, leagues with a format).
  const impAt = new Map(); // season -> [{c, map}]
  if (FORMATS[league]) {
    for (const s of cfg.eval) {
      const games = histories.find((h) => h.season === s)?.games || [];
      const reg = games.filter((g) => !isPlayoff(toGame(g)) && !(pool && !/league/i.test(g.slug)));
      if (reg.length < 50) continue;
      const first = reg[0].day;
      const last = reg[reg.length - 1].day;
      const list = [];
      for (let c = addDays(first, 14); c <= last; c = addDays(c, 7)) {
        const played = games.filter((g) => g.day < c);
        const remaining = reg.filter((g) => g.day >= c).map((g) => ({ id: g.id, h: g.h.id, a: g.a.id, neutral: g.neutral }));
        const targetsSet = new Set(reg.filter((g) => g.day >= c && g.day < addDays(c, 21)).map((g) => g.id));
        const res = simulateSeason({ league, table: standingsFrom(played, league), remaining, rating: (id) => book.asOf(id, c), structure, targets: targetsSet, runs: SIMS });
        list.push({ c, map: res.importance });
      }
      impAt.set(s, list);
    }
  }
  const importanceFor = (season, gameId, day) => {
    const list = impAt.get(season);
    if (!list) return null;
    let best = null;
    for (const cp of list) if (cp.c <= day && cp.map.has(gameId)) best = cp;
    return best ? best.map.get(gameId) : null;
  };

  const rows = [];
  for (const s of cfg.eval) {
    const seasonGames = histories.find((h) => h.season === s)?.games || [];
    for (const g of seasonGames) {
      const t = targets[s][g.id];
      if (!t?.raw || !g.done || g.x || !displayable(league, g)) continue;
      const y = actual(t.raw);
      for (const tier of TIERS) {
        const D = addDays(g.day, -tier.offset);
        const game = toGame(g);
        game.odds = tier.key === 'prediction' && t.line && (t.line.h != null || t.line.sp != null)
          ? { home: t.line.h, away: t.line.a, draw: t.line.d, spread: t.line.sp, overUnder: t.line.ou, details: t.line.det }
          : null;
        const pct = percentiles(s, D);
        const style = styleAt(seasonGames, D);
        const ctx = {
          now: new Date(`${D}T12:00:00-08:00`),
          elo: { home: book.asOf(g.h.id, D), away: book.asOf(g.a.id, D) },
          eloPct: { home: pct.get(g.h.id) ?? 0.5, away: pct.get(g.a.id) ?? 0.5 },
          importance: importanceFor(s, g.id, D),
          structure: { home: structure.get(g.h.id), away: structure.get(g.a.id) },
          style: style ? { home: style.get(g.h.id) ?? 0, away: style.get(g.a.id) ?? 0 } : null,
          leagueSize: seasonTeams.get(s)?.size || 30,
          rulesOnly: true,
        };
        const p = predictGame(game, ctx);
        rows.push({
          tier: tier.key, season: s, day: g.day, group: groupKey(league, g.day), id: g.id,
          x: p.features, rule: p.exact, base: p.base, y, great: y >= 85 ? 1 : 0, dull: y < 40 ? 1 : 0,
          hasLine: !!game.odds, playoff: isPlayoff(game),
        });
      }
    }
  }
  return { league, rows, seasons: cfg.eval, calN: rawRows.length };
}

async function f1Rows() {
  const cache = await readJson(join(TARGET_DIR, 'f1', 'races.json'), {});
  const races = Object.values(cache).filter((r) => r.raw);
  if (races.length < 20) return { league: 'f1', rows: [], note: 'not enough races' };
  const calFile = { league: 'f1', engine: RATING.version, generated: new Date().toISOString(), window: 'races 2023-2026 (backfill)', n: races.length, columns: F1_COMPONENTS, rows: races.map((r) => r.raw) };
  if (WRITE) await writeFile('site/data/calibration/f1.json', JSON.stringify(calFile));
  const cal = prepareCalibration(calFile, 'f1');
  const standingsByYear = {};
  for (const y of [...new Set(races.map((r) => r.year))]) {
    const st = await getJson(`https://site.api.espn.com/apis/v2/sports/racing/f1/standings?season=${y}`).catch(() => null);
    standingsByYear[y] = st ? parseStandings(st.json) : null;
  }
  const rows = [];
  for (const r of races) {
    const y = rawToRating(weighted(normalizeF1(Object.fromEntries(F1_COMPONENTS.map((c, i) => [c, r.raw[i]])), cal.scales), RATING.f1.weights), cal);
    const st = championshipStakes(standingsByYear[r.year], r.raceIndex);
    const game = { league: 'f1', sport: 'racing', isRace: true, state: 'pre', start: r.start, circuit: `${r.circuit} ${r.location}`, gpName: r.location, notes: [], seasonType: 2 };
    for (const tier of TIERS) {
      // Qualifying is only known for the 0-2 day tier.
      const extras = { titleGap: st.gap != null && st.remaining <= 6 ? st.gap : null };
      if (tier.key === 'prediction' && r.qGap != null) { extras.qualiGap = r.qGap; extras.poleMargin = r.qGap; }
      const p = predictGame(game, { now: new Date(new Date(r.start).getTime() - tier.offset * 86400000), extras, rulesOnly: true });
      rows.push({ tier: tier.key, season: r.year, day: r.start.slice(0, 10), group: String(r.year), id: r.location, x: p.features, rule: p.exact, base: p.base, y, great: y >= 85 ? 1 : 0, dull: y < 40 ? 1 : 0, hasLine: false, playoff: false });
    }
  }
  void circuitAverage;
  return { league: 'f1', rows, seasons: [2023, 2024, 2025, 2026], calN: races.length };
}

// ---------------- metrics ----------------

function metrics(rows, pred, pGreat) {
  const y = rows.map((r) => r.y);
  const out = { n: rows.length };
  out.spearman = pred ? spearman(pred, y) : NaN;
  // Within-day (football: within-week) rank correlation, weighted by group size.
  if (pred) {
    const groups = new Map();
    rows.forEach((r, i) => { const k = `${r.season}|${r.group}`; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(i); });
    let wsum = 0; let acc = 0;
    for (const idx of groups.values()) {
      if (idx.length < 4) continue;
      const rho = spearman(idx.map((i) => pred[i]), idx.map((i) => y[i]));
      if (!Number.isFinite(rho)) continue;
      acc += rho * idx.length; wsum += idx.length;
    }
    out.withinDay = wsum ? acc / wsum : NaN;
  } else out.withinDay = NaN;
  // Top-decile precision and Great recall, thresholds per season.
  let topHit = 0; let topN = 0; let greatIn = 0; let greatN = 0;
  const seasons = [...new Set(rows.map((r) => r.season))];
  for (const s of seasons) {
    const idx = rows.map((r, i) => (r.season === s ? i : -1)).filter((i) => i >= 0);
    if (!pred) {
      topHit += idx.filter((i) => y[i] >= 65).length * 0.1; topN += idx.length * 0.1;
      greatIn += idx.filter((i) => y[i] >= 85).length * 0.2; greatN += idx.filter((i) => y[i] >= 85).length;
      continue;
    }
    const sorted = idx.map((i) => pred[i]).sort((a, b) => a - b);
    const t90 = quantile(sorted, 0.9);
    const t80 = quantile(sorted, 0.8);
    for (const i of idx) {
      if (pred[i] >= t90) { topN++; if (y[i] >= 65) topHit++; }
      if (y[i] >= 85) { greatN++; if (pred[i] >= t80) greatIn++; }
    }
  }
  out.top10 = topN ? topHit / topN : NaN;
  out.greatRecall = greatN ? greatIn / greatN : NaN;
  out.auc = pred ? auc(rows.map((r, i) => (r.great ? pred[i] : null)).filter((v) => v != null), rows.map((r, i) => (r.dull ? pred[i] : null)).filter((v) => v != null)) : 0.5;
  out.mae = pred ? mean(pred.map((p, i) => Math.abs(p - y[i]))) : mean(y.map((v) => Math.abs(v - mean(y))));
  if (pGreat) {
    out.brier = mean(pGreat.map((p, i) => (p - rows[i].great) ** 2));
    const bins = [[0, 0.05], [0.05, 0.1], [0.1, 0.15], [0.15, 0.2], [0.2, 0.3], [0.3, 1.01]];
    out.calibration = bins.map(([lo, hi]) => {
      const idx = pGreat.map((p, i) => (p >= lo && p < hi ? i : -1)).filter((i) => i >= 0);
      return { bin: `${Math.round(lo * 100)}-${Math.min(100, Math.round(hi * 100))}%`, n: idx.length, predicted: idx.length ? mean(idx.map((i) => pGreat[i])) : NaN, observed: idx.length ? mean(idx.map((i) => rows[i].great)) : NaN };
    });
  }
  return out;
}

function fitAll(train) {
  const X = train.map((r) => r.x);
  const y = train.map((r) => r.y);
  const model = ridge(X, y, LAMBDA);
  const spread = ridge(X.map((x) => CLOSE_IDX.map((j) => x[j])), y, LAMBDA);
  const qi = ridge(X.map((x) => [(x[QI_IDX[0]] / 6 + x[QI_IDX[1]] / 10) / 2]), y, LAMBDA);
  const fitted = X.map((x) => predictLinear(model, x));
  const great = logistic1(fitted, train.map((r) => r.great));
  const dull = logistic1(fitted, train.map((r) => r.dull));
  return { model, spread, qi, great, dull };
}

const sig = (z) => 1 / (1 + Math.exp(-z));

function evaluateLeague(data) {
  const { rows, seasons } = data;
  const res = { tiers: {} };
  const testSeasons = seasons.slice(1).filter((s) => rows.some((r) => r.season === s));
  for (const tier of TIERS) {
    const tierRows = rows.filter((r) => r.tier === tier.key);
    const test = [];
    const preds = { fitted: [], rules: [], spread: [], qi: [], pGreat: [], resid: [] };
    for (const S of testSeasons) {
      const train = rows.filter((r) => r.season < S); // all tiers pooled, earlier seasons only
      const t = tierRows.filter((r) => r.season === S);
      if (train.length < 60 || !t.length) continue;
      const f = fitAll(train);
      for (const r of t) {
        const p = predictLinear(f.model, r.x);
        test.push(r);
        preds.fitted.push(p);
        preds.rules.push(r.rule);
        preds.spread.push(predictLinear(f.spread, CLOSE_IDX.map((j) => r.x[j])));
        preds.qi.push(predictLinear(f.qi, [(r.x[QI_IDX[0]] / 6 + r.x[QI_IDX[1]] / 10) / 2]));
        preds.pGreat.push(sig(f.great[0] + f.great[1] * p));
        preds.resid.push(r.y - p);
      }
    }
    if (!test.length) { res.tiers[tier.key] = null; continue; }
    const train0 = rows.filter((r) => r.season < testSeasons[0]);
    res.tiers[tier.key] = {
      n: test.length,
      lineShare: test.filter((r) => r.hasLine).length / test.length,
      fitted: metrics(test, preds.fitted, preds.pGreat),
      rules: metrics(test, preds.rules),
      spread: metrics(test, preds.spread),
      qi: metrics(test, preds.qi),
      constant: metrics(test, null),
      withLine: (() => {
        const idx = test.map((r, i) => (r.hasLine ? i : -1)).filter((i) => i >= 0);
        if (idx.length < 40) return null;
        const sub = idx.map((i) => test[i]);
        return {
          fitted: metrics(sub, idx.map((i) => preds.fitted[i]), idx.map((i) => preds.pGreat[i])),
          rules: metrics(sub, idx.map((i) => preds.rules[i])),
          spread: metrics(sub, idx.map((i) => preds.spread[i])),
        };
      })(),
      residIqr: quantile([...preds.resid].sort((a, b) => a - b), 0.75) - quantile([...preds.resid].sort((a, b) => a - b), 0.25),
      constantMae: mean(test.map((r) => Math.abs(r.y - mean(train0.map((x) => x.y))))),
    };
  }
  // Final production model on every season.
  const final = fitAll(rows);
  const finalTiers = {};
  for (const tier of TIERS) {
    const tr = rows.filter((r) => r.tier === tier.key);
    if (!tr.length) continue;
    const fitted = tr.map((r) => predictLinear(final.model, r.x));
    const great = logistic1(fitted, tr.map((r) => r.great));
    const dull = logistic1(fitted, tr.map((r) => r.dull));
    const wf = res.tiers[tier.key];
    const resid = tr.map((r, i) => r.y - fitted[i]).sort((a, b) => a - b);
    finalTiers[tier.key] = {
      iqr: r1(wf?.residIqr ?? (quantile(resid, 0.75) - quantile(resid, 0.25))),
      great: great.map((x) => Math.round(x * 10000) / 10000),
      dull: dull.map((x) => Math.round(x * 10000) / 10000),
      n: tr.length,
    };
  }
  // Rules fallback: slope of outcome on the rule deviation (the k the data supports).
  const dev = rows.map((r) => r.rule - r.base);
  const ys = rows.map((r) => r.y);
  const md = mean(dev); const my = mean(ys);
  let num = 0; let den = 0;
  for (let i = 0; i < dev.length; i++) { num += (dev[i] - md) * (ys[i] - my); den += (dev[i] - md) ** 2; }
  const kFit = den ? num / den * CFG.k : CFG.k;
  const regY = rows.filter((r) => r.tier === 'prediction' && !r.playoff).map((r) => r.y);
  const poY = rows.filter((r) => r.tier === 'prediction' && r.playoff).map((r) => r.y);
  return {
    ...res,
    final: { intercept: Math.round(final.model.intercept * 100) / 100, coef: final.model.coef.map((c) => Math.round(c * 1000) / 1000), tiers: finalTiers },
    kFit,
    baseRegular: regY.length ? median(regY) : null,
    basePlayoff: poY.length >= 20 ? median(poY) : null,
    nPlayoff: poY.length,
    testSeasons,
  };
}

// ---------------- report ----------------

const f2 = (x) => (Number.isFinite(x) ? x.toFixed(2) : '—');
const f0 = (x) => (Number.isFinite(x) ? x.toFixed(1) : '—');
const pc = (x) => (Number.isFinite(x) ? `${Math.round(x * 100)}%` : '—');

function reportLeague(league, data, ev) {
  const L = [`## ${league.toUpperCase()}`, ''];
  if (!ev) { L.push(`_${data.note || 'No data'}_`, ''); return L; }
  L.push(`Seasons ${data.seasons.join(', ')} · ${data.calN} games backfilled · tested on ${ev.testSeasons.join(', ') || '—'} (trained only on earlier seasons) · ${ev.nPlayoff} playoff games.`, '');
  L.push('| Horizon | Model | n | Spearman | Within-day ρ | Top-10% ≥65 | Great recall (top 20%) | AUC Great vs Dull | Brier P(Great) | MAE |');
  L.push('|---|---|---|---|---|---|---|---|---|---|');
  for (const tier of TIERS) {
    const t = ev.tiers[tier.key];
    if (!t) { L.push(`| ${tier.label} | — | 0 | | | | | | | |`); continue; }
    const row = (name, m) => `| ${tier.label} | ${name} | ${m.n} | ${f2(m.spearman)} | ${f2(m.withinDay)} | ${pc(m.top10)} | ${pc(m.greatRecall)} | ${f2(m.auc)} | ${m.brier != null ? m.brier.toFixed(3) : '—'} | ${f0(m.mae)} |`;
    L.push(row('**Fitted ridge**', t.fitted), row('Rules (config)', t.rules), row('Spread only', t.spread), row('538-style quality+importance', t.qi), row('Constant base rate', t.constant));
    if (t.withLine) {
      const lbl = `${tier.label}, closing line`;
      const row2 = (name, m) => `| ${lbl} | ${name} | ${m.n} | ${f2(m.spearman)} | ${f2(m.withinDay)} | ${pc(m.top10)} | ${pc(m.greatRecall)} | ${f2(m.auc)} | ${m.brier != null ? m.brier.toFixed(3) : '—'} | ${f0(m.mae)} |`;
      L.push(row2('**Fitted ridge**', t.withLine.fitted), row2('Rules (config)', t.withLine.rules), row2('Spread only', t.withLine.spread));
    }
  }
  const t0 = ev.tiers.prediction;
  if (t0) {
    const beats = t0.fitted.withinDay > t0.spread.withinDay && t0.fitted.top10 >= t0.spread.top10;
    L.push('', `**Verdict (0-2 days):** ${beats ? 'beats' : 'does not clearly beat'} spread-only on within-day correlation (${f2(t0.fitted.withinDay)} vs ${f2(t0.spread.withinDay)}) and top-decile precision (${pc(t0.fitted.top10)} vs ${pc(t0.spread.top10)}). Closing line available for ${pc(t0.lineShare)} of test games.`);
    if (t0.fitted.calibration) {
      L.push('', 'P(Great) calibration (0-2 days, fitted):', '', '| Predicted | n | Mean predicted | Observed |', '|---|---|---|---|');
      for (const c of t0.fitted.calibration) L.push(`| ${c.bin} | ${c.n} | ${pc(c.predicted)} | ${pc(c.observed)} |`);
    }
  }
  L.push('', `Model in use: **${ev.use}**. Base rate regular ${f0(ev.baseRegular)}${ev.basePlayoff != null ? `, playoff ${f0(ev.basePlayoff)}` : ''}. Rules k supported by the data: ${f2(ev.kFit)}.`, '');
  L.push('<details><summary>Fitted coefficients (points per unit)</summary>', '', '| Feature | Coef |', '|---|---|', ...FEATURES.map((f, i) => `| ${f} | ${ev.final.coef[i]} |`), `| intercept | ${ev.final.intercept} |`, '', '</details>', '');
  return L;
}

async function main() {
  const results = {};
  const cfgOut = JSON.parse(await readFile('site/config/prediction.json', 'utf8'));
  cfgOut.fitted = cfgOut.fitted || {};
  for (const league of LEAGUE_KEYS) {
    const t0 = Date.now();
    const data = league === 'f1' ? await f1Rows() : await teamLeagueRows(league);
    if (!data.rows.length) { results[league] = { data, ev: null }; console.log(`${league}: ${data.note}`); continue; }
    const ev = evaluateLeague(data);
    const t = ev.tiers.prediction;
    // Use the fitted model only where it beats the rules out of sample.
    ev.use = t && t.fitted.withinDay >= (Number.isFinite(t.rules.withinDay) ? t.rules.withinDay : -1) ? 'fitted' : 'rules';
    results[league] = { data, ev };
    cfgOut.fitted[league] = {
      model: ev.use,
      ...(ev.use === 'fitted' ? { intercept: ev.final.intercept, coef: ev.final.coef } : {}),
      k: Math.round(Math.min(1, Math.max(0.2, ev.kFit)) * 100) / 100,
      tiers: ev.final.tiers,
      trainedOn: data.seasons,
      n: data.rows.length / TIERS.length,
      updated: new Date().toISOString().slice(0, 10),
    };
    if (ev.baseRegular != null) cfgOut.base[league].regular = Math.round(ev.baseRegular);
    if (ev.basePlayoff != null) cfgOut.base[league].playoff = Math.round(ev.basePlayoff);
    console.log(`${league.padEnd(5)} rows ${data.rows.length / TIERS.length} · 0-2d within-day ρ fitted ${f2(t?.fitted.withinDay)} / rules ${f2(t?.rules.withinDay)} / spread ${f2(t?.spread.withinDay)} · top10 ${pc(t?.fitted.top10)} vs ${pc(t?.spread.top10)} · ${Math.round((Date.now() - t0) / 1000)}s`);
  }
  const L = ['# Pre-game prediction backtest', '', `Generated ${new Date().toISOString().slice(0, 16)}Z by \`scripts/backtest.mjs\`. Walk-forward: every number below is out of sample. Each test season was predicted by a model trained only on earlier seasons, using information available before kickoff (Elo, standings and simulations rebuilt as of the game date; closing lines only in the 0-2 day tier).`, '',
    'Targets are the post-game excitement ratings from our own algorithm. Metrics:', '',
    '- **Spearman / within-day ρ:** rank correlation of predicted vs actual, overall and within each day (football: each week).',
    '- **Top-10% ≥65:** share of the predicted top 10% of games that rated Good or better.',
    '- **Great recall:** share of actual Great (85+) games that we had in our predicted top 20%.',
    '- **AUC:** how well predictions separate Great from Dull games (0.5 = coin flip).',
    '- **Brier:** accuracy of P(Great) (lower is better; ~0.11 = always guessing the base rate of 12.5%).', ''];
  for (const league of LEAGUE_KEYS) L.push(...reportLeague(league, results[league].data, results[league].ev));
  if (WRITE) {
    await mkdir('reports', { recursive: true });
    await writeFile('reports/backtest.md', `${L.join('\n')}\n`);
    cfgOut.version = (cfgOut.version || 1) + (args['bump'] ? 1 : 0);
    await writeFile('site/config/prediction.json', `${JSON.stringify(cfgOut, null, 2)}\n`);
    console.log('Wrote reports/backtest.md and site/config/prediction.json');
  }
}

export { teamLeagueRows, f1Rows, metrics, evaluateLeague };

if (import.meta.url === `file://${process.argv[1]}`) main();
