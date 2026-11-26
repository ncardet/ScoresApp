#!/usr/bin/env node
// Save known classics and blowouts as trimmed ESPN fixtures for the rating tests.
// Usage: node scripts/make-fixtures.mjs [name ...]   (NODE_USE_ENV_PROXY=1 behind a proxy)
// Output: test/fixtures/<name>.json  { name, league, expect, event (scoreboard), summary (trimmed), advanced?, f1? }

import { writeFile, mkdir } from 'node:fs/promises';
import { ADAPTERS } from '../site/js/adapters/index.js';
import { getJson } from '../site/js/adapters/espn/client.js';
import { parseEvent, parseF1Event } from '../site/js/adapters/espn/parse.js';

// expect: the band the engine must produce. `match` = team abbreviations that must both appear.
export const FIXTURES = [
  { name: 'nba-pacers-thunder-finals-g1', league: 'nba', date: '2025-06-05', match: ['IND', 'OKC'], expect: 'great', note: 'Haliburton winner with 0.3s left, 111-110' },
  { name: 'nba-pacers-knicks-ecf-g1', league: 'nba', date: '2025-05-21', match: ['IND', 'NY'], expect: 'great', note: 'Pacers erase 14-point deficit in final 3 min, win in OT' },
  { name: 'nba-blowout', league: 'nba', date: '2025-11-28', biggestMargin: true, expect: 'dull' },
  { name: 'nfl-super-bowl-lviii', league: 'nfl', date: '2024-02-11', match: ['KC', 'SF'], expect: 'great', note: 'Chiefs win in OT, 25-22' },
  { name: 'nfl-blowout', league: 'nfl', date: '2025-11-23', biggestMargin: true, expect: 'dull' },
  { name: 'mlb-ws-2025-g7', league: 'mlb', date: '2025-11-01', match: ['LAD', 'TOR'], expect: 'great', note: 'Dodgers win Game 7 in 11 innings, 5-4' },
  { name: 'mlb-blowout', league: 'mlb', date: '2026-07-18', biggestMargin: true, expect: 'dull' },
  { name: 'ucl-inter-barcelona-sf', league: 'ucl', date: '2025-05-06', match: ['INT', 'BAR'], expect: 'great', note: 'Inter 4-3 Barcelona after extra time' },
  { name: 'ucl-final-psg-inter', league: 'ucl', date: '2025-05-31', match: ['PSG', 'INT'], expect: 'dull', note: 'PSG 5-0 Inter' },
  { name: 'nhl-blowout', league: 'nhl', date: '2025-12-06', biggestMargin: true, expect: 'dull' },
  { name: 'nhl-ot-thriller', league: 'nhl', date: '2026-01-10', bestThriller: true, expect: 'great' },
  { name: 'f1-las-vegas-2026', league: 'f1', date: '2026-11-21', race: true, expect: 'great', note: 'Won by 0.639s' },
];

function margin(g) {
  return Math.abs((g.home?.score ?? 0) - (g.away?.score ?? 0));
}

// ---- trimming: keep only what the adapters and engine read ----

const pickAth = (a) => a && { id: a.id, displayName: a.displayName, shortName: a.shortName, position: a.position ? { abbreviation: a.position.abbreviation } : undefined };

function trimPlay(p) {
  return {
    id: p.id, sequenceNumber: p.sequenceNumber, type: p.type && { text: p.type.text, type: p.type.type },
    text: p.text, awayScore: p.awayScore, homeScore: p.homeScore,
    period: p.period && { number: p.period.number, type: p.period.type, displayValue: p.period.displayValue },
    clock: p.clock && { displayValue: p.clock.displayValue, value: p.clock.value },
    scoringPlay: p.scoringPlay, scoreValue: p.scoreValue, shootingPlay: p.shootingPlay,
    team: p.team && { id: p.team.id }, outs: p.outs, strength: p.strength && { abbreviation: p.strength.abbreviation },
    summaryType: p.summaryType,
    participants: p.participants?.slice(0, 1).map((x) => ({ athlete: x.athlete && { displayName: x.athlete.displayName } })),
  };
}

function trimSummary(j) {
  const out = {};
  if (j.header) {
    const c = j.header.competitions?.[0] || {};
    out.header = {
      id: j.header.id, season: j.header.season,
      competitions: [{
        date: c.date, neutralSite: c.neutralSite, notes: c.notes, series: c.series, status: c.status,
        competitors: (c.competitors || []).map((x) => ({
          id: x.id, homeAway: x.homeAway, winner: x.winner, score: x.score, shootoutScore: x.shootoutScore,
          linescores: x.linescores, record: x.record, rank: x.rank,
          team: x.team && { id: x.team.id, abbreviation: x.team.abbreviation, displayName: x.team.displayName, shortDisplayName: x.team.shortDisplayName, name: x.team.name, location: x.team.location, color: x.team.color, alternateColor: x.team.alternateColor, logos: x.team.logos?.slice(0, 2) },
        })),
      }],
    };
  }
  if (j.plays) out.plays = j.plays.map(trimPlay);
  if (j.drives) {
    out.drives = {
      previous: (j.drives.previous || []).map((d) => ({
        id: d.id, team: d.team && { id: d.team.id }, displayResult: d.displayResult, description: d.description, isScore: d.isScore,
        plays: (d.plays || []).map(trimPlay),
      })),
    };
  }
  if (j.winprobability) out.winprobability = j.winprobability.map((w) => ({ homeWinPercentage: w.homeWinPercentage, tiePercentage: w.tiePercentage, playId: w.playId }));
  if (j.boxscore) {
    out.boxscore = {
      teams: (j.boxscore.teams || []).map((t) => ({ team: { id: t.team?.id, abbreviation: t.team?.abbreviation }, homeAway: t.homeAway, statistics: (t.statistics || []).map((s) => ({ name: s.name, label: s.label, displayValue: s.displayValue })) })),
      players: (j.boxscore.players || []).map((t) => ({
        team: { id: t.team?.id, abbreviation: t.team?.abbreviation },
        statistics: (t.statistics || []).map((g) => ({
          name: g.name, type: g.type, text: g.text, labels: g.labels, keys: g.keys, totals: g.totals,
          athletes: (g.athletes || []).map((a) => ({ athlete: pickAth(a.athlete), starter: a.starter, didNotPlay: a.didNotPlay, stats: a.stats })),
        })),
      })),
    };
  }
  for (const k of ['pickcenter', 'predictor', 'gameInfo']) if (j[k]) out[k] = j[k];
  if (out.gameInfo) out.gameInfo = { venue: { fullName: j.gameInfo.venue?.fullName }, attendance: j.gameInfo.attendance };
  if (j.keyEvents) out.keyEvents = j.keyEvents.map((k) => ({ id: k.id, type: k.type, text: k.text, period: k.period, clock: k.clock, scoringPlay: k.scoringPlay, shootout: k.shootout, team: k.team && { id: k.team.id, displayName: k.team.displayName }, participants: k.participants?.slice(0, 1) }));
  if (j.commentary) out.commentary = j.commentary.map((c) => ({ sequence: c.sequence, time: c.time, text: c.text, play: c.play && { id: c.play.id, type: c.play.type && { type: c.play.type.type }, period: c.play.period, clock: c.play.clock, team: c.play.team && { id: c.play.team.id, displayName: c.play.team.displayName } } }));
  if (j.rosters) out.rosters = j.rosters.map((r) => ({ homeAway: r.homeAway, team: r.team && { id: r.team.id }, formation: r.formation, roster: (r.roster || []).map((p) => ({ starter: p.starter, jersey: p.jersey, batOrder: p.batOrder, formationPlace: p.formationPlace, subbedIn: p.subbedIn, subbedOut: p.subbedOut, position: p.position && { abbreviation: p.position.abbreviation }, athlete: pickAth(p.athlete), stats: (p.stats || []).filter((s) => ['totalGoals', 'yellowCards', 'redCards'].includes(s.name)) })) }));
  return out;
}

async function findEvent(fx) {
  const a = ADAPTERS[fx.league];
  const sb = await getJson(a.urls.scoreboard(fx.date));
  const events = sb.json.events || [];
  if (fx.league === 'f1') return events[0];
  const games = events.map((e) => ({ e, g: parseEvent(e, fx.league) })).filter((x) => x.g.state === 'post' && !x.g.canceled);
  if (fx.match) {
    const hit = games.find(({ g }) => fx.match.every((ab) => [g.home.abbr, g.away.abbr].includes(ab)));
    return hit?.e;
  }
  if (fx.biggestMargin) return games.sort((x, y) => margin(y.g) - margin(x.g))[0]?.e;
  if (fx.bestThriller) {
    // Overtime game with the most goals.
    const ot = games.filter(({ g }) => /OT|SO/.test(g.detail));
    const pool = ot.length ? ot : games;
    return pool.sort((x, y) => ((y.g.home.score + y.g.away.score) - (x.g.home.score + x.g.away.score)) || (margin(x.g) - margin(y.g)))[0]?.e;
  }
  return null;
}

async function main() {
  const only = new Set(process.argv.slice(2));
  await mkdir('test/fixtures', { recursive: true });
  for (const fx of FIXTURES) {
    if (only.size && !only.has(fx.name)) continue;
    try {
      const ev = await findEvent(fx);
      if (!ev) { console.log(`${fx.name}: no matching event on ${fx.date}`); continue; }
      const a = ADAPTERS[fx.league];
      const out = { name: fx.name, league: fx.league, expect: fx.expect, note: fx.note || '', date: fx.date, event: ev };
      if (fx.league === 'f1') {
        const race = parseF1Event(ev).find((g) => g.isRace);
        const detail = await a.summary(race, { standings: true });
        out.f1 = { laps: detail.f1.laps, overtakes: detail.f1.overtakes, control: detail.f1.control, classification: detail.f1.classification, raceIndex: detail.f1.raceIndex, standings: detail.f1.standings };
      } else {
        const s = await getJson(a.urls.summary(ev.id));
        out.summary = trimSummary(s.json);
        if (a.league.sport === 'soccer') {
          const adv = await a.soccerAdvanced(parseEvent(ev, fx.league)).catch(() => null);
          if (adv) {
            const keep = ['expectedGoals', 'totalShots', 'shotsOnTarget', 'possessionPct', 'bigChanceCreated', 'wonCorners'];
            out.advanced = Object.fromEntries(['home', 'away'].map((side) => [side, Object.fromEntries(keep.map((k) => [k, adv[side]?.[k]]))]));
          }
        }
      }
      await writeFile(`test/fixtures/${fx.name}.json`, JSON.stringify(out));
      const comp = ev.competitions?.[0];
      const desc = fx.league === 'f1' ? ev.name : comp.competitors.map((c) => `${c.team.abbreviation} ${c.score}`).join(' - ');
      console.log(`${fx.name}: saved ${desc} (${ev.id})`);
    } catch (e) {
      console.log(`${fx.name}: ERROR ${e.message}`);
    }
  }
}

main();
