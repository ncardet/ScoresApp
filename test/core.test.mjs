// Time zone, where-to-watch and parsing helpers (no network).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ptDateKey, addDays, formatTime, dayLabel, clockToSeconds } from '../site/js/core/time.js';
import { clockT, soccerMinuteT, baseballT } from '../site/js/core/gametime.js';
import { whereToWatch, canonicalNetwork } from '../site/js/core/watch.js';
import { MY_SERVICES } from '../site/config/services.js';
import { scoreFromGoalText } from '../site/js/adapters/espn/summary.js';
import { parseOdds } from '../site/js/adapters/espn/parse.js';
import { LEAGUE_BY_KEY } from '../site/js/core/leagues.js';

test('Pacific dates across DST', () => {
  // 2026-03-08 10:30 UTC = 03:30 PDT (after the spring-forward at 2am).
  assert.equal(ptDateKey(new Date('2026-03-08T10:30:00Z')), '2026-03-08');
  // 07:59 UTC on Nov 27 is still Nov 26 in PST.
  assert.equal(ptDateKey(new Date('2026-11-27T07:59:00Z')), '2026-11-26');
  assert.equal(formatTime('2026-11-26T18:00:00Z'), '10:00 AM');
  assert.equal(formatTime('2026-07-04T18:00:00Z'), '11:00 AM');
  assert.equal(addDays('2026-02-28', 1), '2026-03-01');
  assert.equal(addDays('2026-11-01', -1), '2026-10-31');
  assert.equal(dayLabel('2026-11-26', '2026-11-26'), 'Today');
  assert.equal(dayLabel('2026-11-27', '2026-11-26'), 'Tomorrow');
});

test('game time axis', () => {
  const nba = LEAGUE_BY_KEY.nba;
  assert.equal(clockT(nba, 1, '12:00'), 0);
  assert.equal(clockT(nba, 4, '0.0'), 1);
  assert.ok(Math.abs(clockT(nba, 5, '2:30') - (48 + 2.5) / 48) < 1e-9, 'overtime extends past 1');
  const nhl = LEAGUE_BY_KEY.nhl;
  assert.ok(Math.abs(clockT(nhl, 2, '10:00', { clockMode: 'elapsed' }) - 0.5) < 1e-9);
  assert.equal(soccerMinuteT("45'+3'"), 0.5);
  assert.ok(soccerMinuteT("46'") > 0.5);
  assert.equal(soccerMinuteT("90'+6'"), 1);
  assert.equal(baseballT(9, 'bottom', 3), 1);
  assert.equal(clockToSeconds('1:05'), 65);
});

test('where to watch maps networks to my services', () => {
  const espn = whereToWatch([{ name: 'ESPN', market: 'national' }], MY_SERVICES);
  assert.equal(espn.status, 'ok');
  assert.deepEqual(espn.options[0].services, ['YouTube TV']);
  const nbc = whereToWatch([{ name: 'NBC' }], MY_SERVICES);
  assert.deepEqual(nbc.options[0].services, ['YouTube TV', 'Peacock']);
  const usa = whereToWatch([{ name: 'USA Net' }], MY_SERVICES);
  assert.equal(usa.options[0].network, 'USA Network');
  const apple = whereToWatch([{ name: 'Apple TV' }], MY_SERVICES);
  assert.equal(apple.status, 'none');
  assert.equal(apple.label, 'Not on your services');
  const peacock = whereToWatch([{ name: 'Peacock' }], MY_SERVICES);
  assert.equal(peacock.label, 'Peacock');
  const noTv = whereToWatch([], MY_SERVICES);
  assert.equal(noTv.status, 'unknown');
  // Turning a service off removes it.
  const tnt = whereToWatch([{ name: 'TNT' }], ['HBO Max']);
  assert.deepEqual(tnt.options[0].services, ['HBO Max']);
  assert.equal(canonicalNetwork('Amazon Prime Video'), 'Prime Video');
});

test('soccer goal text gives the running score', () => {
  assert.deepEqual(scoreFromGoalText('Goal! Brentford 1, Everton 0. Keane Lewis-Potter (Brentford) right footed shot.'), [1, 0]);
  assert.deepEqual(scoreFromGoalText('Own Goal by Jarrad Branthwaite, Everton.  Brentford 2, Everton 0.'), [2, 0]);
  assert.deepEqual(scoreFromGoalText('Goal! FC Schalke 04 1, Bayern Munich 2. Someone scores.'), [1, 2]);
});

test('odds become vig-free probabilities', () => {
  const o = parseOdds([{
    details: 'CHI -1.5', spread: 1.5, overUnder: 44.5,
    homeTeamOdds: { favorite: false }, awayTeamOdds: { favorite: true },
    moneyline: { home: { close: { odds: '+105' } }, away: { close: { odds: '-125' } } },
  }], 'football');
  assert.ok(Math.abs(o.home + o.away - 1) < 1e-9);
  assert.ok(o.away > o.home);
  assert.equal(o.spread, 1.5, 'spread oriented to the home team (home underdog = +)');
  const soccer = parseOdds([{ moneyline: { home: { close: { odds: '+150' } }, away: { close: { odds: '+170' } } }, drawOdds: { moneyLine: 230 } }], 'soccer');
  assert.ok(Math.abs(soccer.home + soccer.away + soccer.draw - 1) < 1e-9);
});

test('morning brief gate is daylight-saving-proof', async () => {
  const { shouldRun } = await import('../scripts/build-brief.mjs');
  const none = '/nonexistent/brief.json';
  // Winter (PST, UTC-8): 12:50 UTC = 4:50 am -> run; 13:50 UTC = 5:50 am -> run (backup).
  assert.equal((await shouldRun(new Date('2026-12-10T12:50:00Z'), none)).run, true);
  assert.equal((await shouldRun(new Date('2026-12-10T13:50:00Z'), none)).run, true);
  // Summer (PDT, UTC-7): 12:50 UTC = 5:50 am -> run; 13:50 UTC = 6:50 am -> run.
  assert.equal((await shouldRun(new Date('2026-07-10T12:50:00Z'), none)).run, true);
  assert.equal((await shouldRun(new Date('2026-07-10T13:50:00Z'), none)).run, true);
  // Afternoon in LA -> skip.
  assert.equal((await shouldRun(new Date('2026-07-10T21:00:00Z'), none)).run, false);
  // Night before (11 pm PT) -> skip.
  assert.equal((await shouldRun(new Date('2026-07-11T06:00:00Z'), none)).run, false);
});

test('brief v2: top 5 by Watch Priority, at most 2 per league; skip is never a pick; sleeper outside the top', async () => {
  const { selectSections, skipWarning } = await import('../scripts/build-brief.mjs');
  let n = 0;
  const mk = (league, value, { priority = value, pGreat = 0.1, pDull = 0.1, fav = false, terms = [], probs = { home: 0.5, away: 0.5 } } = {}) => {
    n++;
    const g = { key: `${league}:${n}`, id: String(n), league, sport: 'basketball', state: 'pre', home: { id: 'h', short: `Home${n}` }, away: { id: 'a', short: `Away${n}` }, broadcasts: [] };
    const pred = { value, pGreat, pDull, priority, priorityParts: fav ? [{ label: 'Favorite', points: 5 }] : [], terms, probs };
    return { g, r: { state: 'predicted', value, pred } };
  };
  const rated = [
    mk('nba', 80), mk('nba', 79), mk('nba', 78), // third NBA game must be skipped by the league cap
    mk('nfl', 70), mk('nhl', 60), mk('epl', 55), mk('mlb', 50, { pGreat: 0.3 }),
    mk('nba', 45, { priority: 54, fav: true, pDull: 0.5, terms: [{ key: 'closeness', points: -8, spread: 14, text: 'Heavy favorite' }], probs: { home: 0.9, away: 0.1 } }),
  ];
  const { top, sleeper, skip } = selectSections(rated);
  assert.deepEqual(top.map((x) => x.r.value), [80, 79, 70, 60, 55]);
  assert.ok(top.filter((x) => x.g.league === 'nba').length <= 2);
  assert.equal(skip.r.value, 45, 'the favorite projecting Dull is the skip');
  assert.ok(!top.some((x) => x.g.key === skip.g.key));
  assert.equal(sleeper.r.value, 50, 'highest P(Great) outside the top 5');
  assert.equal(skipWarning(skip.g, skip.r.pred), `${skip.g.home.short} −14: blowout risk`);
});

test('every league has a sport icon, drawn only in the text colour', async () => {
  const { SPORT_ICONS } = await import('../site/js/ui/dom.js');
  const { LEAGUES } = await import('../site/js/core/leagues.js');
  for (const l of LEAGUES) assert.ok(Object.hasOwn(SPORT_ICONS, l.sport), `${l.key}: no icon for "${l.sport}"`);
  for (const [sport, svg] of Object.entries(SPORT_ICONS)) {
    for (const [, c] of svg.matchAll(/\b(?:fill|stroke)="([^"]*)"/g)) assert.ok(['currentColor', 'none'].includes(c), `${sport}: ${c}`);
    assert.doesNotMatch(svg, /#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i, sport);
  }
});

test('WNBA networks map to your services; Paramount+ Essential keeps only NFL on CBS', () => {
  const w = (name, league = 'wnba', market = 'national') => whereToWatch([{ name, market }], MY_SERVICES, league).options[0]?.services;
  assert.deepEqual(w('Prime Video'), ['Prime Video']);
  assert.deepEqual(w('Peacock'), ['Peacock']);
  assert.deepEqual(w('ION'), ['YouTube TV']);
  assert.deepEqual(w('NBA TV'), ['YouTube TV']);
  assert.deepEqual(w('ESPN+'), ['YouTube TV']);
  assert.deepEqual(w('ESPN Unlimited'), ['YouTube TV']);
  assert.deepEqual(w('NBC'), ['YouTube TV', 'Peacock']);
  assert.deepEqual(w('CBS'), ['YouTube TV'], 'Essential has no live local CBS');
  assert.deepEqual(w('CBS', 'nfl'), ['YouTube TV', 'Paramount+'], 'Essential includes NFL on CBS');
  // Local Sparks broadcasts: only home/away-market channels, none on your services.
  const local = whereToWatch([{ name: 'Spectrum Sports Net', market: 'home' }, { name: 'WNBA League Pass', market: 'away' }], MY_SERVICES, 'wnba');
  assert.equal(local.status, 'none');
  assert.equal(local.label, 'Not on your services (local TV)');
  assert.equal(whereToWatch([{ name: 'Apple TV', market: 'national' }], MY_SERVICES, 'mls').label, 'Not on your services');
});

test('free YouTube: mapped, ahead of YouTube TV, labeled as available (WSL: Paramount+ first)', () => {
  const yt = whereToWatch([{ name: 'YouTube', market: 'national' }], MY_SERVICES, 'nfl');
  assert.equal(yt.status, 'ok');
  assert.equal(yt.label, 'Free on YouTube');
  assert.ok(yt.free);
  for (const name of ['NFL on YouTube', 'NBC Sports YouTube', 'WSL YouTube']) assert.equal(canonicalNetwork(name), 'YouTube', name);
  const both = whereToWatch([{ name: 'NBC', market: 'national' }, { name: 'NBC Sports YouTube', market: 'national' }], MY_SERVICES, 'nfl');
  assert.equal(both.options[0].network, 'YouTube');
  assert.equal(both.short, 'Free on YouTube');
  // An unlisted YouTube-like name still counts as free YouTube; YouTube TV never does.
  assert.equal(whereToWatch([{ name: 'WNBA on YouTube' }], MY_SERVICES, 'wnba').label, 'Free on YouTube');
  assert.notEqual(whereToWatch([{ name: 'YouTube TV' }], MY_SERVICES, 'nba').label, 'Free on YouTube');
  // WSL: Paramount+ carries every match, so it comes first.
  const wsl = whereToWatch([{ name: 'WSL YouTube', market: 'national' }, { name: 'Paramount+', market: 'national' }], MY_SERVICES, 'wsl');
  assert.equal(wsl.options[0].network, 'Paramount+');
  // Switched off in Settings: not offered.
  assert.equal(whereToWatch([{ name: 'YouTube' }], MY_SERVICES.filter((s) => s !== 'YouTube (free)'), 'nfl').status, 'none');
});

test('unmapped broadcasters are logged per day, with leagues, markets and YouTube-like names', async () => {
  const { mergeUnmapped } = await import('../scripts/lib/unmapped.mjs');
  const games = [
    { league: 'wnba', broadcasts: [{ name: 'Spectrum Sports Net', market: 'home' }, { name: 'ION', market: 'national' }] },
    { league: 'nfl', broadcasts: [{ name: 'NFL Brazil on YouTube', market: 'national' }] },
  ];
  const day1 = mergeUnmapped(null, games, '2026-11-27');
  assert.deepEqual(Object.keys(day1.names).sort(), ['NFL Brazil on YouTube', 'Spectrum Sports Net']);
  assert.deepEqual(day1.names['Spectrum Sports Net'].markets, ['home']);
  assert.deepEqual(day1.names['Spectrum Sports Net'].leagues, ['wnba']);
  assert.equal(day1.names['NFL Brazil on YouTube'].youtubeLike, true);
  assert.equal(mergeUnmapped(day1, games, '2026-11-27').names['Spectrum Sports Net'].days, 1, 'the same day counts once');
  assert.equal(mergeUnmapped(day1, games, '2026-11-28').names['Spectrum Sports Net'].days, 2);
});

test('a service added to the config starts on for a phone that saved its toggles earlier', async () => {
  const store = { 'sideline.settings.v1': JSON.stringify({ services: ['YouTube TV', 'Peacock'] }) };
  globalThis.localStorage = { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = v; } };
  try {
    const { getSettings, saveSettings } = await import('../site/js/core/settings.js');
    saveSettings({}); // drop any cached copy
    assert.deepEqual(getSettings().services, ['YouTube (free)', 'YouTube TV', 'Peacock']);
    saveSettings({ services: ['YouTube TV'] }); // switched YouTube (free) off on purpose
    assert.deepEqual(getSettings().services, ['YouTube TV']);
  } finally {
    delete globalThis.localStorage;
  }
});

test('off-season: next game day from ESPN calendars or the cached season; Look Ahead lines', async () => {
  const { firstCalendarDay, firstSeasonDay } = await import('../scripts/lib/offseason.mjs');
  const { offSeasonLines, returnsLabel } = await import('../site/js/core/offseason.js');
  // Day whitelist (NBA, WNBA): the listed dates have games.
  assert.equal(firstCalendarDay({ calendar: ['2026-12-01T08:00Z', '2027-05-15T07:00Z'], calendarIsWhitelist: true }, '2026-12-11'), '2027-05-15');
  // MLB blacklist: the listed dates are the days without games.
  assert.equal(firstCalendarDay({ calendar: ['2027-02-18T08:00Z', '2027-02-19T08:00Z'], calendarIsWhitelist: false, calendarStartDate: '2027-02-18T08:00Z', calendarEndDate: '2027-12-11T07:59Z' }, '2026-12-11'), '2027-02-20');
  // List calendars (NFL weeks): each week's start.
  assert.equal(firstCalendarDay({ calendar: [{ label: 'Preseason', startDate: '2026-08-06T07:00Z', entries: [{ startDate: '2026-08-06T07:00Z' }, { startDate: '2026-08-13T07:00Z' }] }] }, '2026-08-07'), '2026-08-13');
  assert.equal(firstCalendarDay({ calendar: [], calendarIsWhitelist: true }, '2026-12-11'), null, 'nothing scheduled');
  assert.equal(firstSeasonDay([{ st: 'post', day: '2026-12-20' }, { st: 'pre', day: '2027-01-05' }, { st: 'pre', x: true, day: '2026-12-15' }], '2026-12-11'), '2027-01-05');
  // One line per off-season league, only for the leagues passed in (enabled), in their order.
  const leagues = [{ key: 'wnba', short: 'WNBA', sport: 'basketball' }, { key: 'mlb', short: 'MLB', sport: 'baseball' }, { key: 'nba', short: 'NBA', sport: 'basketball' }];
  const lines = offSeasonLines({ mlb: { returns: '2027-02-19', preseason: true }, wnba: { returns: null } }, leagues, '2026-11-27');
  assert.deepEqual(lines.map((l) => l.text), ['WNBA: off-season', 'MLB returns Feb 19, 2027 (preseason)']);
  assert.equal(returnsLabel('2026-12-05', '2026-11-27'), 'Dec 5');
  assert.deepEqual(offSeasonLines({}, leagues, '2026-11-27'), [], 'leagues with games in the next 14 days get no line');
});

test('What my services cover: services per league from the config, with the known gaps', async () => {
  const { coverage } = await import('../site/js/core/watch.js');
  const nba = coverage('nba', MY_SERVICES);
  assert.deepEqual(nba.on, ['YouTube TV', 'Prime Video', 'Peacock']);
  assert.deepEqual(nba.missing, ['Lakers local games on Spectrum SportsNet']);
  const mlb = coverage('mlb', MY_SERVICES);
  assert.ok(mlb.missing.includes('Dodgers local games on SportsNet LA'));
  assert.equal(mlb.missing.filter((m) => m === 'MLB Network').length, 1, 'noted once');
  assert.ok(coverage('nhl', MY_SERVICES).missing.includes('Kings local games on ABTV / DAZN'));
  assert.ok(coverage('nfl', MY_SERVICES).missing.includes('NFL RedZone'));
  assert.ok(coverage('nfl', MY_SERVICES).missing.some((m) => /Sunday Ticket/.test(m)));
  assert.deepEqual(coverage('f1', MY_SERVICES), { on: [], missing: ['Apple TV'] });
  // A service switched off on the phone moves its networks to "missing".
  assert.ok(coverage('epl', MY_SERVICES.filter((s) => s !== 'Peacock')).missing.includes('Peacock'));
  // Every league has an entry.
  const { LEAGUES } = await import('../site/js/core/leagues.js');
  const { LEAGUE_CARRIERS } = await import('../site/config/services.js');
  for (const l of LEAGUES) assert.ok(LEAGUE_CARRIERS[l.key]?.length, l.key);
});
