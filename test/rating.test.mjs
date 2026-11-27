// Rating maths on saved games (no network): classics must rate Great (85+), blowouts Dull (<40).
// Uses the committed calibration files in site/data/calibration, like the app does.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadFixture, FIXTURE_NAMES } from './load-fixture.mjs';
import { rate, measure, predict, getCalibration, bandOf } from '../site/js/rating/index.js';
import { percentile, curveValue, prepareCalibration, rawToRating } from '../site/js/rating/calibrate.js';
import { swing, leadChanges, closeness } from '../site/js/rating/components.js';
import { marginWp, soccerWp, hockeyWp, splitRates, runsWp } from '../site/js/rating/wp.js';
import { stakesFactor } from '../site/js/rating/prior.js';
import RATING from '../site/config/rating.js';

for (const name of FIXTURE_NAMES) {
  test(`fixture ${name}`, async () => {
    const { fx, detail } = await loadFixture(name);
    const cal = await getCalibration(fx.league);
    const r = rate(detail, cal);
    assert.ok(r, 'rating produced');
    assert.equal(r.state, 'final');
    const msg = `${name}: got ${r.value} (${r.band.label}) — ${r.explain}`;
    if (fx.expect === 'great') assert.ok(r.value >= 85, msg);
    if (fx.expect === 'dull') assert.ok(r.value < 40, msg);
    assert.ok(r.explain.length > 0, 'has an explanation');
  });
}

test('WNBA-only flags: late comeback, 20/20 and triple-double (not in the NBA)', async () => {
  const { novelty } = await import('../site/js/rating/components.js');
  const box = [{ groups: [{ keys: ['minutes', 'points', 'rebounds', 'assists', 'steals', 'blocks'], rows: [
    { name: 'A. Wilson', stats: ['36', '24', '21', '3', '1', '2'] },
    { name: 'C. Clark', stats: ['35', '18', '10', '13', '2', '0'] },
  ] }] }];
  // Home trails by 8 entering the final minute of a 40-minute game (t >= 0.975) and wins.
  const tl = { final: true, scores: [
    { t: 0, hs: 0, as: 0 }, { t: 0.96, hs: 70, as: 78 }, { t: 0.985, hs: 76, as: 78 }, { t: 0.999, hs: 79, as: 78 },
  ] };
  const keys = (league) => novelty(tl, { game: { league, period: 4 }, plays: [], box }, 1).flags.map((f) => f.key);
  const wnba = keys('wnba');
  for (const k of ['lateComeback', 'twentyTwenty', 'tripleDouble']) assert.ok(wnba.includes(k), `wnba: ${k} in ${wnba}`);
  const nba = keys('nba');
  for (const k of ['lateComeback', 'twentyTwenty', 'tripleDouble']) assert.ok(!nba.includes(k), `nba: no ${k}`);
  // A 6-point deficit in the final minute is not enough (threshold 7).
  const tl6 = { final: true, scores: [{ t: 0, hs: 0, as: 0 }, { t: 0.96, hs: 72, as: 78 }, { t: 0.999, hs: 79, as: 78 }] };
  assert.ok(!novelty(tl6, { game: { league: 'wnba', period: 4 }, plays: [], box: [] }, 1).flags.some((f) => f.key === 'lateComeback'));
});

test("WNBA Commissioner's Cup final: moderate stakes, kept out of the standings table", async () => {
  const { countsInStandings } = await import('../site/js/predict/simulate.js');
  const cup = { notes: ["WNBA Commissioner's Cup Championship"] };
  assert.equal(countsInStandings(cup, 'wnba'), false);
  assert.equal(countsInStandings({ notes: [] }, 'wnba'), true);
  assert.equal(stakesFactor({ notes: cup.notes, seasonType: 2 }).value, 0.5);
});

test('explanations name the drama', async () => {
  const sb = rate((await loadFixture('nfl-super-bowl-lviii')).detail, await getCalibration('nfl'));
  assert.match(sb.explain, /Overtime/);
  const ws = rate((await loadFixture('mlb-ws-2025-g7')).detail, await getCalibration('mlb'));
  assert.match(ws.explain, /Extra innings \(11\)/);
  const ecf = rate((await loadFixture('nba-pacers-knicks-ecf-g1')).detail, await getCalibration('nba'));
  assert.match(ecf.explain, /Came back from 1\d down|Overtime/);
  const blow = rate((await loadFixture('nfl-blowout')).detail, await getCalibration('nfl'));
  assert.ok(blow.reasons.some((r) => r.tone === '-'), 'dull game explains what was missing');
});

test('live rating blends prediction and in-game signals', async () => {
  const { detail } = await loadFixture('nba-pacers-thunder-finals-g1');
  const cal = await getCalibration('nba');
  // Cut the game at halftime and pretend it is live.
  const half = detail.plays.filter((p) => p.t <= 0.5);
  const last = half.at(-1);
  const liveDetail = {
    ...detail,
    plays: half,
    wp: detail.wp.filter((w) => w.t <= 0.5),
    game: { ...detail.game, state: 'in', completed: false, period: 2, clock: '0.0', home: { ...detail.game.home, score: last.hs, winner: false }, away: { ...detail.game.away, score: last.as, winner: false } },
  };
  const r = rate(liveDetail, cal);
  assert.equal(r.state, 'live');
  assert.ok(r.value > 0 && r.value <= 100);
  assert.ok(r.progress > 0.45 && r.progress <= 0.55, `progress ${r.progress}`);
});

test('predicted rating uses context', async () => {
  const cal = await getCalibration('nba');
  const base = {
    league: 'nba', sport: 'basketball', state: 'pre', notes: [], seasonType: 2,
    home: { id: '13', record: '30-10', rank: null }, away: { id: '2', record: '29-11', rank: null },
    odds: { home: 0.52, away: 0.48, draw: null, spread: -1.5, source: 'moneyline' },
  };
  const rivalry = predict(base, cal);
  const mismatch = predict({ ...base, home: { id: '1', record: '35-5' }, away: { id: '3', record: '5-35' }, odds: { home: 0.93, away: 0.07, spread: -15.5 } }, cal);
  const game7 = predict({ ...base, seasonType: 3, notes: ['NBA Finals - Game 7'], series: { homeWins: 3, awayWins: 3, toWin: 4, total: 7 } }, cal);
  assert.equal(rivalry.state, 'predicted');
  assert.ok(rivalry.value > mismatch.value, `rivalry ${rivalry.value} > mismatch ${mismatch.value}`);
  assert.ok(game7.value > rivalry.value, `game 7 ${game7.value} > rivalry ${rivalry.value}`);
  assert.ok(game7.value >= 65, `game 7 predicted ${game7.value}`);
  assert.ok(mismatch.value < 45, `mismatch predicted ${mismatch.value}`);
  assert.match(mismatch.explain, /blowout risk/);
  assert.match(game7.explain, /Game 7/);
  // Prediction carries its uncertainty.
  assert.ok(rivalry.pred.low < rivalry.value && rivalry.pred.high > rivalry.value);
  assert.ok(rivalry.pred.pGreat > 0 && rivalry.pred.pGreat < 1);
});

test('calibration: median maps to 50 and 87.5th percentile to 85', () => {
  assert.equal(curveValue(0.5), 50);
  assert.equal(curveValue(0.875), 85);
  assert.equal(curveValue(1), 100);
  const sorted = Array.from({ length: 101 }, (_, i) => i / 100);
  assert.ok(Math.abs(percentile(sorted, 0.5) - 0.5) < 0.01);
  const cal = prepareCalibration({ rows: Array.from({ length: 200 }, (_, i) => [i / 40, i / 200, i / 20, i / 200, 0, 1, 0]) }, 'nba');
  const mid = cal.finals[100];
  assert.ok(Math.abs(rawToRating(mid, cal) - 50) < 1.5);
});

test('bands follow the Thuuz scale', () => {
  assert.equal(bandOf(39).key, 'dull');
  assert.equal(bandOf(40).key, 'ok');
  assert.equal(bandOf(64).key, 'ok');
  assert.equal(bandOf(65).key, 'good');
  assert.equal(bandOf(84).key, 'good');
  assert.equal(bandOf(85).key, 'great');
});

test('GEI is length-normalised (textbook settings)', () => {
  const saved = { k: RATING.swingLateBoost, step: RATING.swingResample };
  RATING.swingLateBoost = 0;
  RATING.swingResample = 0;
  try {
    const pts = [{ t: 0, wp: 0.5 }, { t: 0.5, wp: 0.8 }, { t: 1, wp: 0.2 }, { t: 1.25, wp: 1 }];
    const full = swing(pts, 1.25);
    assert.ok(Math.abs(full.sum - 1.7) < 1e-9);
    assert.ok(Math.abs(full.raw - 1.7 / 1.25) < 1e-9, 'overtime divides by T_elapsed');
    const half = swing(pts, 0.5);
    assert.ok(Math.abs(half.raw - 0.3 / 0.5) < 1e-9, 'live extrapolates by T_reg / T_elapsed');
  } finally {
    RATING.swingLateBoost = saved.k;
    RATING.swingResample = saved.step;
  }
});

test('late swings count more than early ones (default settings)', () => {
  const early = [{ t: 0, wp: 0.5 }, { t: 0.1, wp: 0.9 }, { t: 0.2, wp: 0.5 }, { t: 1, wp: 0.5 }];
  const late = [{ t: 0, wp: 0.5 }, { t: 0.85, wp: 0.9 }, { t: 0.95, wp: 0.5 }, { t: 1, wp: 0.5 }];
  const a = swing(early, 1);
  const b = swing(late, 1);
  assert.ok(Math.abs(a.sum - b.sum) < 1e-9, 'same total movement');
  assert.ok(b.raw > a.raw * 2, `late ${b.raw} vs early ${a.raw}`);
});

test('lead changes and ties are counted and late ones weigh more', () => {
  const scores = [
    { t: 0, hs: 0, as: 0 }, { t: 0.1, hs: 2, as: 0 }, { t: 0.2, hs: 2, as: 3 }, // lead change
    { t: 0.5, hs: 5, as: 3 }, // lead change
    { t: 0.95, hs: 5, as: 5 }, // tie
    { t: 0.99, hs: 5, as: 7 }, // lead change (after tie)
  ];
  const lc = leadChanges(scores, 1, false);
  assert.equal(lc.changes, 3);
  assert.equal(lc.ties, 1);
  assert.equal(lc.late, 2);
  assert.ok(lc.raw > 4, 'late events boosted');
});

test('closeness measures the late window', () => {
  const pts = [{ t: 0, wp: 0.5 }, { t: 0.85, wp: 0.95 }];
  const scores = [{ t: 0, hs: 0, as: 0 }, { t: 0.85, hs: 10, as: 0 }];
  const c = closeness(pts, scores, 0.8, 1, 3);
  assert.ok(Math.abs(c.raw - 0.25) < 1e-6);
});

test('fallback win-probability models behave', () => {
  assert.ok(Math.abs(marginWp(0, 1, 13) - 0.5) < 0.02);
  assert.ok(marginWp(10, 0.1, 13) > 0.95);
  assert.equal(marginWp(-1, 0, 13), 0);
  const rates = splitRates(2.8, 0.45, 0.28);
  assert.ok(rates.home > rates.away);
  assert.equal(soccerWp(1, 0, rates), 1);
  assert.ok(soccerWp(1, 0.5, rates) > 0.7);
  assert.ok(Math.abs(hockeyWp(0, 0, { home: 3, away: 3 }) - 0.52) < 1e-9);
  assert.ok(runsWp(3, 1 / 54) > 0.95);
});

test('stakes: game 7, elimination, regular season', () => {
  const g7 = stakesFactor({ seasonType: 3, notes: ['World Series - Game 7'], series: { homeWins: 3, awayWins: 3, toWin: 4 }, state: 'pre' });
  assert.equal(g7.value, 1);
  const elim = stakesFactor({ seasonType: 3, notes: ['East Semifinals - Game 5'], series: { homeWins: 3, awayWins: 1, toWin: 4 }, state: 'pre' });
  assert.equal(elim.value, 0.8);
  const reg = stakesFactor({ seasonType: 2, notes: [] });
  assert.equal(reg.value, 0);
});

test('measure() reports where win probability came from', async () => {
  const nba = measure((await loadFixture('nba-blowout')).detail);
  assert.equal(nba.timeline.source, 'espn');
  const nhl = measure((await loadFixture('nhl-blowout')).detail);
  assert.equal(nhl.timeline.source, 'model');
});

test('reversed play-by-play sides are detected and fixed (neutral-site ESPN quirk)', async () => {
  const { readFile } = await import('node:fs/promises');
  const { parseEvent } = await import('../site/js/adapters/espn/parse.js');
  const { parseSummary } = await import('../site/js/adapters/espn/summary.js');
  const fx = JSON.parse(await readFile(new URL('./fixtures/nfl-super-bowl-lviii.json', import.meta.url), 'utf8'));
  const good = parseSummary(fx.summary, fx.league, parseEvent(fx.event, fx.league));
  assert.ok(!good.sidesFixed, 'a normal game is left alone');
  // Swap every play's homeScore/awayScore, as ESPN did for 2026 Toledo vs Michigan (Baha Mar).
  const flipped = structuredClone(fx.summary);
  for (const d of flipped.drives?.previous || []) {
    for (const p of d.plays || []) if (p.homeScore != null) [p.homeScore, p.awayScore] = [p.awayScore, p.homeScore];
  }
  const fixed = parseSummary(flipped, fx.league, parseEvent(fx.event, fx.league));
  assert.ok(fixed.sidesFixed, 'reversal detected');
  const last = fixed.plays.filter((p) => p.hs != null).at(-1);
  assert.equal(last.hs, Number(fixed.game.home.score));
  assert.equal(last.as, Number(fixed.game.away.score));
  const cal = await getCalibration('nfl');
  assert.equal(rate(fixed, cal).value, rate(good, cal).value, 'same rating as the untouched game');
});

test('F1: the chequered flag is not a red flag; pit stops are not passes; a charge counts', async () => {
  const { raceControlSummary } = await import('../site/js/adapters/f1.js');
  const { measureF1 } = await import('../site/js/rating/f1.js');
  const rc = raceControlSummary([{ flag: 'RED', message: 'RED FLAG', lap_number: 1 }, { flag: 'CHEQUERED', message: 'CHEQUERED FLAG', lap_number: 6 }]);
  assert.equal(rc.redFlags, 1, '"CHEQUERED FLAG" contains "RED FLAG" but is the finish');
  const lap = (n, order, pits = []) => ({ lap: n, order, pits, gap12: 2 });
  const laps = [
    lap(1, [1, 2, 3]), lap(2, [1, 2, 3]),
    lap(3, [2, 3, 1], [1]), // the leader pits: everyone behind moves up, nobody passed anyone
    lap(4, [2, 3, 1]), lap(5, [2, 3, 1]),
    lap(6, [3, 2, 1]), // an on-track pass for the lead
  ];
  const m = measureF1({ f1: { laps, control: rc, classification: [{ position: 1, number: 3, gap: null }, { position: 2, number: 2, gap: 0.8 }, { position: 3, number: 1, gap: 9 }] } });
  assert.equal(m.raw.overtakes, 1);
  assert.equal(m.raw.leadChanges, 1);
  assert.equal(m.facts.charge.from, 3, 'the winner was third after lap 1');
  assert.ok(m.raw.charge > 0);
});
