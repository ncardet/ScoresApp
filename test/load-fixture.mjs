// Rebuild a GameDetail from a saved fixture, exactly as the adapters would.
import { readFile } from 'node:fs/promises';
import { parseEvent, parseF1Event } from '../site/js/adapters/espn/parse.js';
import { parseSummary } from '../site/js/adapters/espn/summary.js';
import { raceControlSummary } from '../site/js/adapters/f1.js';

export async function loadFixture(name) {
  const fx = JSON.parse(await readFile(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8'));
  if (fx.league === 'f1') {
    const race = parseF1Event(fx.event).find((g) => g.isRace);
    return {
      fx,
      detail: {
        key: race.key, league: 'f1', sport: 'racing', game: race, plays: [], wp: null,
        // Raw race-control messages (when saved) are re-summarized, so parser fixes apply.
        f1: { results: race.drivers, ...fx.f1, ...(fx.f1.rc ? { control: raceControlSummary(fx.f1.rc) } : {}) },
      },
    };
  }
  const base = parseEvent(fx.event, fx.league);
  const detail = parseSummary(fx.summary, fx.league, base);
  if (detail.soccer && fx.advanced) {
    detail.soccer.advanced = fx.advanced;
    detail.soccer.xg = { home: fx.advanced.home.expectedGoals, away: fx.advanced.away.expectedGoals };
  }
  return { fx, detail };
}

export const FIXTURE_NAMES = [
  'nba-pacers-thunder-finals-g1', 'nba-pacers-knicks-ecf-g1', 'nba-blowout',
  'nfl-super-bowl-lviii', 'nfl-blowout',
  'mlb-ws-2025-g7', 'mlb-blowout',
  'ucl-inter-barcelona-sf', 'ucl-final-psg-inter',
  'nhl-ot-thriller', 'nhl-blowout',
  'f1-las-vegas-2026',
  'wnba-finals-2024-g5', 'wnba-semis-2025-g5', 'wnba-blowout',
];
