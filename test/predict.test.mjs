// Pre-game model: odds maths, blowout guard, live blend, horizons, leakage guard.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { moneylineToProb, removeMargin, noVig, pFav } from '../site/js/predict/odds.js';
import { predictGame, liveBlend, pregameView, horizonFor, FEATURES } from '../site/js/predict/index.js';
import { blowoutGuard, step } from '../site/js/predict/terms.js';
import { probabilities, update, regress } from '../site/js/predict/elo.js';

test('moneyline -> probability, margin removed', () => {
  assert.equal(moneylineToProb(100), 0.5);
  assert.ok(Math.abs(moneylineToProb(-150) - 0.6) < 1e-9);
  assert.ok(Math.abs(moneylineToProb('+150') - 0.4) < 1e-9);
  assert.equal(moneylineToProb(0), null);
  const raw = { home: moneylineToProb(-110), away: moneylineToProb(-110) };
  assert.ok(raw.home + raw.away > 1, 'book margin present');
  const nv = removeMargin(raw);
  assert.ok(Math.abs(nv.home - 0.5) < 1e-9 && Math.abs(nv.home + nv.away - 1) < 1e-9);
  const soccer = noVig({ home: +140, away: +190, draw: +230 });
  assert.ok(Math.abs(soccer.home + soccer.away + soccer.draw - 1) < 1e-9);
  assert.ok(Math.abs(pFav({ home: 0.62, away: 0.38 }) - 0.62) < 1e-9);
});

test('blowout guard caps stakes + narrative when closeness <= -7', () => {
  const terms = [
    { key: 'closeness', group: 'closeness', points: -12 },
    { key: 'stakes', group: 'stakes', points: 10 },
    { key: 'rivalry', group: 'narrative', points: 4 },
  ];
  const { applied } = blowoutGuard(terms, -12);
  assert.equal(applied, true);
  const capped = terms.filter((t) => t.group !== 'closeness').reduce((s, t) => s + t.points, 0);
  assert.ok(Math.abs(capped - 4) < 1e-9, `stakes+narrative = ${capped}`);
  const ok = [{ key: 'stakes', group: 'stakes', points: 10 }];
  assert.equal(blowoutGuard(ok, -6).applied, false, 'no guard for a competitive matchup');
  // End to end: a 14.5-point playoff favourite is not rescued by the stakes.
  const g = {
    league: 'nfl', sport: 'football', start: '2027-01-10T21:00:00Z', seasonType: 3, notes: ['AFC Wild Card Playoffs'],
    home: { id: '2', abbr: 'BUF', short: 'Bills' }, away: { id: '28', abbr: 'TEN', short: 'Titans' },
    odds: { home: 0.9, away: 0.1, spread: -14.5, details: 'BUF -14.5' },
  };
  const p = predictGame(g, { now: new Date('2027-01-09T20:00:00Z') });
  assert.equal(p.guard, true);
  assert.match(p.explain, /blowout risk/);
});

test('spread buckets follow the NFL table', () => {
  const nfl = [[3, 8], [6.5, 3], [9.5, -2], [13.5, -7], [999, -12]];
  assert.equal(step(nfl, 3), 8);
  assert.equal(step(nfl, 3.5), 3);
  assert.equal(step(nfl, 7), -2);
  assert.equal(step(nfl, 10), -7);
  assert.equal(step(nfl, 14), -12);
});

test('live blend: w = (1 - progress)^2', () => {
  assert.equal(liveBlend(80, 20, 0), 80);
  assert.equal(liveBlend(80, 20, 1), 20);
  assert.equal(liveBlend(80, 20, 0.5), 0.25 * 80 + 0.75 * 20);
  assert.equal(liveBlend(80, 20, 1.3), 20, 'overtime clamps to measured');
});

test('horizon tiers', () => {
  assert.equal(horizonFor(0).key, 'prediction');
  assert.equal(horizonFor(2).key, 'prediction');
  assert.equal(horizonFor(3).key, 'forecast');
  assert.equal(horizonFor(7).key, 'forecast');
  assert.equal(horizonFor(8).key, 'early');
  assert.equal(horizonFor(14).key, 'early');
  assert.equal(horizonFor(15).key, 'circle');
  const g = { league: 'nba', sport: 'basketball', start: '2026-12-08T03:00:00Z', home: { id: '13' }, away: { id: '2' } };
  const p = predictGame(g, { now: new Date('2026-11-27T20:00:00Z'), elo: { home: 1600, away: 1580 } });
  assert.equal(p.horizon.key, 'early');
  assert.equal(p.value % 5, 0, 'early look is rounded to 5');
});

test('leakage guard: features ignore everything known after kickoff', () => {
  const pre = {
    league: 'nba', sport: 'basketball', start: '2026-03-01T03:00:00Z', state: 'pre', seasonType: 3,
    notes: ['East First Round - Game 5'], series: { homeWins: 3, awayWins: 1, total: 7, toWin: 4 },
    home: { id: '13', abbr: 'LAL', short: 'Lakers', record: '50-20' }, away: { id: '2', abbr: 'BOS', short: 'Celtics', record: '48-22' },
    odds: { home: 0.55, away: 0.45, spread: -2.5, overUnder: 228, details: 'LAL -2.5' },
    broadcasts: [{ name: 'ESPN', market: 'national' }],
  };
  // The same game after it was played: scores, winner, status, plays, live data, and ESPN's
  // post-game series record (which already counts this game).
  const post = {
    ...pre, state: 'post', completed: true, detail: 'Final/OT', period: 5, clock: '0.0',
    home: { ...pre.home, score: 120, winner: true, linescores: [30, 30, 30, 20, 10], record: '51-20' },
    away: { ...pre.away, score: 118, winner: false, linescores: [30, 30, 30, 20, 8], record: '48-23' },
    series: { homeWins: 4, awayWins: 1, total: 7, toWin: 4, summary: 'LAL win series 4-1' },
    live: { homeWinProb: 1 }, plays: [{ t: 1, hs: 120, as: 118 }], soccer: null,
  };
  const ctx = { now: new Date('2026-02-28T20:00:00Z'), elo: { home: 1650, away: 1640 }, eloPct: { home: 0.9, away: 0.85 } };
  const a = predictGame(pre, ctx);
  const b = predictGame(post, ctx);
  assert.deepEqual(b.features, a.features, `features changed after kickoff: ${FEATURES.map((f, i) => `${f}:${a.features[i]}->${b.features[i]}`).join(' ')}`);
  assert.equal(b.exact, a.exact);
  // The pre-game view exposes no post-kickoff fields at all.
  const view = pregameView(post);
  for (const k of ['score', 'winner', 'linescores', 'record']) assert.equal(view.home[k], undefined, `home.${k} leaked`);
  for (const k of ['completed', 'detail', 'period', 'clock', 'live', 'plays']) assert.equal(view[k], undefined, `${k} leaked`);
  assert.equal(view.state, 'pre');
  assert.deepEqual([view.series.homeWins, view.series.awayWins], [3, 1], 'series record backed out to pre-game');
});

test('Elo basics', () => {
  const p = probabilities(1500, 1500, 'nba');
  assert.ok(p.home > 0.6 && p.home < 0.66, 'home court ~ +100 Elo');
  const soccer = probabilities(1500, 1500, 'epl');
  assert.ok(Math.abs(soccer.home + soccer.draw + soccer.away - 1) < 1e-9 && soccer.draw > 0.2);
  const u = update(1500, 1500, 30, 10, 'nba');
  assert.ok(u.home > 1500 && Math.abs(u.home - 1500 + (u.away - 1500)) < 1e-9, 'zero-sum update');
  assert.equal(regress(1600, 'nba'), 1505 + 95 * 0.75);
});

test('probable starters: MLB aces and bullpen games, NHL backup goalies', async () => {
  const { probableExtras } = await import('../site/js/predict/terms.js');
  const now = new Date('2026-07-01T12:00:00Z');
  const mlb = (h, a, start = '2026-07-01T23:05Z') => ({ league: 'mlb', sport: 'baseball', start, home: { id: '1', short: 'Dodgers', probable: h }, away: { id: '2', short: 'Padres', probable: a } });
  const ace = (name) => ({ name, era: 2.4, wins: 9, losses: 3 });
  assert.equal(probableExtras(mlb(ace('Yamamoto'), ace('King')), { now }).aces, 'King vs Yamamoto');
  assert.equal(probableExtras(mlb(ace('Yamamoto'), { name: 'Rookie', era: 1.5, wins: 1, losses: 0 }), { now }).aces, undefined, 'early-season ERA does not count');
  assert.equal(probableExtras(mlb(ace('Yamamoto'), null), { now }).bullpen, true);
  assert.equal(probableExtras(mlb(ace('Yamamoto'), null, '2026-07-04T23:05Z'), { now }).bullpen, undefined, 'too far out to know');
  const nhl = { league: 'nhl', sport: 'hockey', home: { id: '26', short: 'Kings', probable: { name: 'Backup Guy' } }, away: { id: '25', short: 'Ducks', probable: { name: 'Lukas Dostal' } } };
  assert.deepEqual(probableExtras(nhl, { goalieNo1: { home: 'Darcy Kuemper', away: 'Lukas Dostal' } }).goalie, { home: 'backup' });
  assert.deepEqual(probableExtras(nhl, {}), {}, 'no usual-starter data: no term');
});

test('weather: NFL wind and snow outdoors, MLB rain; never indoors', async () => {
  const { computeTerms } = await import('../site/js/predict/terms.js');
  const nfl = (over = {}) => ({ league: 'nfl', sport: 'football', start: '2026-11-29T18:00Z', home: { id: '4', short: 'Bengals' }, away: { id: '18', short: 'Saints' }, ...over });
  const w = (g, ctx = {}) => computeTerms(g, ctx).terms.find((t) => t.group === 'weather');
  assert.match(w(nfl(), { extras: { windGust: 27 } }).text, /Wind gusts near 27 mph/);
  assert.match(w(nfl({ weather: { text: 'Snow showers' } })).text, /Snow/);
  assert.equal(w(nfl({ indoor: true, weather: { text: 'Snow' } }), { extras: { windGust: 40 } }), undefined);
  assert.equal(w(nfl(), { extras: { windGust: 12 } }), undefined);
  const mlb = { league: 'mlb', sport: 'baseball', start: '2026-07-01T23:05Z', home: { id: '19', short: 'Dodgers' }, away: { id: '25', short: 'Padres' }, weather: { text: 'Thunderstorms' } };
  assert.ok(w(mlb).points < 0);
});
