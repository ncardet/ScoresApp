// Sanity checks on hand-labeled Great / Dull games (test/fixtures/labeled_games.csv).
// These were picked after the fact as extremes, so they are a sanity check, not the headline
// metric (see reports/backtest.md for that).
//   - The post-game algorithm puts >= 90% of fixtures in the labeled band.
//   - No Great fixture rates below 75.
//   - No Dull fixture is PREDICTED Great before kickoff.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseOdds } from '../site/js/adapters/espn/parse.js';
import { loadLabeled } from './load-labeled.mjs';
import { rate, getCalibration } from '../site/js/rating/index.js';
import { predictGame } from '../site/js/predict/index.js';

const BANDS = {
  G: (v) => v >= 85,
  G95: (v) => v >= 85,
  GOOD: (v) => v >= 65 && v < 85,
  D: (v) => v < 40,
  DOK: (v) => v < 65,
  OK: (v) => v >= 40 && v < 65,
  OKMAX: (v) => v <= 64,
};

const labeled = await loadLabeled();

test('labeled fixtures: post-game bands', { skip: !labeled.length && 'no labeled fixtures built' }, async () => {
  const rows = [];
  for (const { fx, detail } of labeled) {
    const cal = await getCalibration(fx.league);
    const r = rate(detail, cal);
    const ok = BANDS[fx.band](r.value);
    rows.push({ slug: fx.slug, band: fx.band, value: r.value, ok, why: r.explain });
  }
  const hit = rows.filter((r) => r.ok).length / rows.length;
  const misses = rows.filter((r) => !r.ok).map((r) => `${r.slug} [${r.band}] = ${r.value} (${r.why})`);
  console.log(`labeled post-game: ${rows.filter((r) => r.ok).length}/${rows.length} in band`);
  if (misses.length) console.log(`  misses:\n   ${misses.join('\n   ')}`);
  assert.ok(hit >= 0.9, `only ${Math.round(hit * 100)}% in band:\n${misses.join('\n')}`);
  const lowGreat = rows.filter((r) => /^G/.test(r.band) && r.band !== 'GOOD' && r.value < 75);
  assert.equal(lowGreat.length, 0, `Great fixtures below 75: ${lowGreat.map((r) => `${r.slug}=${r.value}`).join(', ')}`);
});

test('labeled fixtures: no Dull game is predicted Great', { skip: !labeled.length && 'no labeled fixtures built' }, async () => {
  const bad = [];
  for (const { fx, game } of labeled) {
    if (!/^D/.test(fx.band)) continue;
    const pre = { ...game };
    if (fx.summary?.pickcenter) pre.odds = parseOdds(fx.summary.pickcenter, game.sport);
    const now = new Date(new Date(game.start).getTime() - 12 * 3600e3);
    const ctx = fx.league === 'f1'
      ? { now, extras: { qualiGap: fx.f1.qualiGap, poleMargin: fx.f1.qualiGap } }
      : { now, elo: fx.pregame?.elo, eloPct: fx.pregame?.eloPct, leagueSize: fx.pregame?.leagueSize };
    const p = predictGame(pre, ctx);
    if (p && p.value >= 85) bad.push(`${fx.slug}: predicted ${p.value} (${p.explain})`);
  }
  assert.equal(bad.length, 0, bad.join('\n'));
});
