// Event-style optional leagues on ESPN's site API:
//   - NASCAR Cup races and UFC cards: schedule, results and where to watch, not rated (ESPN has the
//     finishing order and fight results, but no lead changes, cautions or round-by-round data).
//   - Tennis Grand Slams: singles matches, rated from the set scores (rating/tennis.js).

import { getJson } from './client.js';
import { parseStatus, parseBroadcasts } from './parse.js';
import { SITE } from './league.js';
import { LEAGUE_BY_KEY } from '../../core/leagues.js';
import { espnDate, ptDateKey } from '../../core/time.js';

function eventStub(league) {
  return {
    async summary(game) { return { game, plays: [], box: null }; },
    async standings() { return { groups: [] }; },
    async teams() { return []; },
    league,
  };
}

const uniqBroadcasts = (list) => {
  const seen = new Set();
  return list.filter((b) => !seen.has(b.name.toLowerCase()) && seen.add(b.name.toLowerCase()));
};

/** NASCAR: one row per race, with the top three when it's over. */
function raceGame(ev, league) {
  const comp = ev.competitions?.[0] || {};
  const drivers = (comp.competitors || [])
    .map((d) => ({
      id: String(d.id), order: d.order ?? null, name: d.athlete?.displayName || '', short: d.athlete?.shortName || '',
      flag: d.athlete?.flag?.href || '', winner: !!d.winner, team: '',
    }))
    .sort((a, b) => (a.order ?? 999) - (b.order ?? 999));
  const title = (ev.shortName || ev.name || '').replace(/^NASCAR Cup Series (at )?/i, '') || ev.name;
  return {
    key: `${league}:${ev.id}`, id: String(ev.id), eventId: String(ev.id), league, sport: 'racing', kind: 'event',
    name: ev.name, gpName: ev.name, shortName: title, session: 'Race', sessionLabel: 'Race', isRace: false,
    start: comp.date || ev.date, ...parseStatus(comp.status || ev.status),
    home: null, away: null, drivers, circuit: ev.circuit?.fullName || comp.venue?.fullName || ev.name || '',
    broadcasts: parseBroadcasts(comp), odds: null, notes: [], series: null, seasonType: ev.season?.type ?? null, live: null,
  };
}

/** UFC: one row per card (the last fight listed is the main event). */
function cardGame(ev, league) {
  const fights = ev.competitions || [];
  const main = fights.at(-1);
  const names = (c) => (c?.competitors || []).map((x) => x.athlete?.shortName || x.athlete?.displayName || '');
  const winner = (main?.competitors || []).find((x) => x.winner);
  const loser = (main?.competitors || []).find((x) => !x.winner);
  const done = parseStatus(ev.status || main?.status);
  return {
    key: `${league}:${ev.id}`, id: String(ev.id), eventId: String(ev.id), league, sport: 'mma', kind: 'event',
    name: ev.name, gpName: ev.name, shortName: ev.name || ev.shortName, session: 'Card', sessionLabel: `${fights.length} fights`, isRace: false,
    start: ev.date || main?.date, ...done,
    home: null, away: null, drivers: [],
    result: done.state === 'post' && winner && loser ? `${winner.athlete?.shortName || winner.athlete?.displayName} def. ${loser.athlete?.shortName || loser.athlete?.displayName}` : '',
    mainEvent: names(main).filter(Boolean).join(' vs '),
    circuit: main?.venue?.fullName || ev.venues?.[0]?.fullName || '',
    broadcasts: uniqBroadcasts(fights.flatMap((c) => parseBroadcasts(c))), odds: null, notes: [], series: null, seasonType: ev.season?.type ?? null, live: null,
  };
}

async function eventsFor(league, dateKey, ctx) {
  const lg = LEAGUE_BY_KEY[league];
  const res = await getJson(`${SITE}/${lg.espn}/scoreboard?dates=${espnDate(dateKey)}`, { persist: !!ctx.persist });
  return { events: res.json?.events || [], at: res.at, stale: res.stale };
}

/** NASCAR Cup races (schedule and results only). */
export function raceLeague(league) {
  return {
    ...eventStub(league),
    async scoreboard(dateKey, ctx = {}) {
      const { events, at, stale } = await eventsFor(league, dateKey, ctx);
      return { games: events.map((e) => raceGame(e, league)), at, stale };
    },
  };
}

/** UFC cards (schedule and results only). */
export function cardLeague(league) {
  return {
    ...eventStub(league),
    async scoreboard(dateKey, ctx = {}) {
      const { events, at, stale } = await eventsFor(league, dateKey, ctx);
      return { games: events.map((e) => cardGame(e, league)), at, stale };
    },
  };
}

// ---------- tennis ----------

const EARLY = /^(round [12]|1st round|2nd round|first round|second round)$/i;
/** Early rounds list only matches with a top-16 seed (128-player draws would flood Today). */
export const TENNIS_EARLY_SEED = 16;

function player(c) {
  const sets = (c.linescores || []).map((l) => ({ g: Number(l.value) || 0, tb: l.tiebreak ?? null, won: !!l.winner }));
  const seed = Number.parseInt(c.seed ?? c.curatedRank?.current ?? '', 10);
  return {
    id: String(c.id), name: c.athlete?.displayName || c.athlete?.fullName || '', short: c.athlete?.shortName || c.athlete?.displayName || '',
    abbr: c.athlete?.shortName || '', logo: c.athlete?.flag?.href || '', logoDark: '', color: null, altColor: null,
    rank: Number.isFinite(seed) && seed > 0 ? seed : null, seed: Number.isFinite(seed) && seed > 0 ? seed : null,
    winner: !!c.winner, sets, score: sets.length ? sets.filter((s) => s.won).length : null,
  };
}

/** Grand Slam singles matches on a Pacific day, from a tour scoreboard's tournament events. */
export function tennisMatches(events, dateKey) {
  const out = [];
  for (const ev of events || []) {
    if (!ev.major) continue;
    for (const g of ev.groupings || []) {
      const draw = g.grouping?.displayName || '';
      if (!/singles/i.test(draw)) continue;
      for (const m of g.competitions || []) {
        const round = m.round?.displayName || '';
        if (/qualif/i.test(round)) continue;
        const start = m.date || m.startDate;
        if (!start || ptDateKey(new Date(start)) !== dateKey) continue;
        const [p1, p2] = [...(m.competitors || [])].sort((a, b) => (a.order ?? 9) - (b.order ?? 9)).map(player);
        if (!p1 || !p2 || !p1.name || !p2.name) continue;
        if (EARLY.test(round) && !((p1.seed && p1.seed <= TENNIS_EARLY_SEED) || (p2.seed && p2.seed <= TENNIS_EARLY_SEED))) continue;
        out.push({
          key: `tennis:${m.id}`, id: String(m.id), eventId: String(ev.id), league: 'tennis', sport: 'tennis',
          name: `${p1.name} vs ${p2.name}`, start, ...parseStatus(m.status),
          away: p1, home: p2, bestOf: /women/i.test(draw) ? 3 : 5, round, tournament: ev.name, draw,
          notes: [`${ev.name} · ${draw} · ${round}`],
          broadcasts: parseBroadcasts(m), odds: null, series: null, seasonType: null, live: null,
        });
      }
    }
  }
  return out;
}

/** Tennis Grand Slams: the ATP and WTA feeds, deduplicated (both carry the joint majors). */
export function tennisLeague(league = 'tennis') {
  return {
    ...eventStub(league),
    async scoreboard(dateKey, ctx = {}) {
      const res = await Promise.all(['atp', 'wta'].map((tour) => getJson(`${SITE}/tennis/${tour}/scoreboard?dates=${espnDate(dateKey)}`, { persist: !!ctx.persist }).catch(() => null)));
      const seen = new Set();
      const games = res.flatMap((r) => tennisMatches(r?.json?.events, dateKey)).filter((g) => !seen.has(g.key) && seen.add(g.key));
      const ok = res.filter(Boolean);
      return { games, at: Math.max(0, ...ok.map((r) => r.at || 0)) || Date.now(), stale: ok.some((r) => r.stale) };
    },
  };
}
