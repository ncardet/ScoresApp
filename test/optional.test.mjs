// Optional leagues: off by default, switched on per league, schedule-only where ESPN has no rating
// data, kept out of the morning brief unless the config says so, and a basic tennis rating.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LEAGUES, CORE_LEAGUES, OPTIONAL_LEAGUES } from '../site/js/core/leagues.js';
import { ADAPTERS } from '../site/js/adapters/index.js';
import { rateTennis, predictedTennis } from '../site/js/rating/tennis.js';
import { tennisMatches } from '../site/js/adapters/espn/events.js';

function withStorage(saved, fn) {
  const store = { 'sideline.settings.v1': JSON.stringify(saved) };
  globalThis.localStorage = { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = v; } };
  return fn().finally(() => { delete globalThis.localStorage; });
}

test('optional leagues: the probed ones only (Unrivaled is not on ESPN), each with an adapter', () => {
  assert.deepEqual(OPTIONAL_LEAGUES.map((l) => l.key), ['seriea', 'uecl', 'uwcl', 'nascar', 'tennis', 'ufc']);
  assert.ok(!LEAGUES.some((l) => /unrivaled/i.test(`${l.key} ${l.name}`)), 'no slug, no toggle');
  for (const l of OPTIONAL_LEAGUES) {
    assert.ok(ADAPTERS[l.key]?.scoreboard, `${l.key} adapter`);
    assert.ok(l.espn && l.note, `${l.key} slug and Settings note`);
  }
  assert.equal(CORE_LEAGUES.length + OPTIONAL_LEAGUES.length, LEAGUES.length);
  assert.ok(CORE_LEAGUES.some((l) => l.key === 'wnba'), 'the WNBA is core');
});

test('optional leagues are off by default; switching one on adds it (and its chip) on that phone', async () => {
  const { enabledLeagues, saveSettings } = await import('../site/js/core/settings.js');
  await withStorage({}, async () => {
    saveSettings({});
    const keys = enabledLeagues().map((l) => l.key);
    assert.ok(!OPTIONAL_LEAGUES.some((l) => keys.includes(l.key)), 'none by default');
    assert.ok(keys.includes('wnba'));
    saveSettings({ optionalLeagues: ['tennis'] });
    const on = enabledLeagues().map((l) => l.key);
    assert.ok(on.includes('tennis'));
    assert.ok(!on.includes('seriea'));
    // Standings chips: only leagues with standings (not tennis, NASCAR or UFC).
    assert.ok(!enabledLeagues().filter((l) => l.standings !== false).some((l) => l.key === 'tennis'));
  });
});

test('the brief leaves optional leagues out unless brief.includeOptional is on', async () => {
  const { briefLeagues } = await import('../scripts/build-brief.mjs');
  const keys = (brief) => briefLeagues(brief).map((l) => l.key);
  assert.ok(!keys({ includeOptional: false, optionalLeagues: ['seriea'] }).includes('seriea'));
  assert.ok(!keys(undefined).some((k) => OPTIONAL_LEAGUES.some((l) => l.key === k)));
  const on = keys({ includeOptional: true, optionalLeagues: ['seriea'] });
  assert.ok(on.includes('seriea'));
  assert.ok(!on.includes('tennis'), 'only the listed optional leagues');
  assert.ok(on.includes('wnba') && on.includes('nba'), 'core leagues always');
});

const match = (a, b, extra = {}) => ({
  league: 'tennis', sport: 'tennis', state: 'post', bestOf: 5, round: 'Round 3',
  away: { sets: a.map(([g, tb]) => ({ g, tb: tb ?? null })), winner: false },
  home: { sets: b.map(([g, tb]) => ({ g, tb: tb ?? null })), winner: false },
  ...extra,
});
function won(m, side) { m[side].winner = true; for (let i = 0; i < m.away.sets.length; i++) { const x = m.away.sets[i].g; const y = m.home.sets[i].g; m.away.sets[i].won = x > y; m.home.sets[i].won = y > x; } return m; }

test('tennis: five sets, tiebreaks and a comeback rate high; a straight-sets rout rates low', () => {
  // Away takes the first two sets (6-3, 7-6); home wins the next three (6-4, 7-6, 7-6): a comeback.
  const epic = won(match([[6], [7, 7], [4], [6, 4], [6]], [[3], [6, 5], [6], [7, 7], [7]]), 'home');
  const r = rateTennis({ ...epic, round: 'Final' });
  assert.equal(r.state, 'final');
  assert.ok(r.value >= 85, `epic final ${r.value}: ${r.explain}`);
  assert.match(r.explain, /Five sets/);
  assert.match(r.explain, /two sets down/);
  const rout = won(match([[6], [6], [6]], [[1], [0], [2]]), 'away');
  const rr = rateTennis(rout);
  assert.ok(rr.value < 40, `rout ${rr.value}: ${rr.explain}`);
  const pre = predictedTennis({ round: 'Semifinal' });
  assert.equal(pre.state, 'predicted');
  assert.equal(pre.value, 57, 'base 50 plus the semifinal');
});

test('tennis feed: Grand Slam singles on the day; early rounds need a top-16 seed; no qualifying', () => {
  const comp = (id, round, date, seeds) => ({
    id, date, round: { displayName: round }, status: { type: { state: 'pre' } },
    competitors: seeds.map((seed, i) => ({ id: `${id}${i}`, order: i + 1, seed, athlete: { displayName: `P${id}${i}`, shortName: `P${i}` }, linescores: [] })),
  });
  const ev = {
    id: 'rg', name: 'Roland Garros', major: true,
    groupings: [
      { grouping: { displayName: "Men's Singles" }, competitions: [
        comp('1', 'Round 1', '2026-05-24T17:00Z', [5, null]),
        comp('2', 'Round 1', '2026-05-24T18:00Z', [null, 40]),
        comp('3', 'Qualifying 1st Round', '2026-05-24T09:00Z', [1, null]),
        comp('4', 'Round 3', '2026-05-24T19:00Z', [null, null]),
      ] },
      { grouping: { displayName: "Men's Doubles" }, competitions: [comp('5', 'Final', '2026-05-24T20:00Z', [1, 2])] },
    ],
  };
  const minor = { ...ev, id: 'x', major: false };
  const got = tennisMatches([ev, minor], '2026-05-24').map((g) => g.id).sort();
  assert.deepEqual(got, ['1', '4']);
  assert.equal(tennisMatches([ev], '2026-05-24')[0].bestOf, 5);
});
