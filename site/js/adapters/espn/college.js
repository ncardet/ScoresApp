// College leagues show AP Top 25 games plus favorite teams (USC), and during March Madness
// every NCAA tournament game. ESPN's default basketball scoreboard only lists ranked games, so
// a favorite's game is fetched from its conference scoreboard when it is missing.

import { espnLeague } from './league.js';
import { getJson } from './client.js';

const RANK_TTL = 6 * 3600 * 1000;
const rankCache = new Map(); // league -> {at, map}
const groupCache = new Map(); // `${league}:${teamId}` -> conference group id

/** NCAA tournament window (Selection Sunday through the title games). */
export function inTournamentWindow(dateKey) {
  const md = dateKey.slice(5);
  return md >= '03-14' && md <= '04-10';
}

const isNcaaTournament = (g) =>
  g.seasonType === 3 && g.notes.some((n) => /NCAA (Men's|Women's) Basketball Championship|First Four|Final Four/i.test(n)) &&
  !g.notes.some((n) => /\bNIT\b|CBI|CIT|Crown/i.test(n));

export function collegeLeague(key) {
  const adapter = espnLeague(key);
  const lg = adapter.league;

  /** AP Top 25: Map(teamId -> rank). Cached for 6 hours. */
  adapter.apRanks = async () => {
    const hit = rankCache.get(key);
    if (hit && Date.now() - hit.at < RANK_TTL) return hit.map;
    const res = await getJson(adapter.urls.rankings(), { persist: true });
    const polls = res.json?.rankings || [];
    const ap = polls.find((p) => p.type === 'ap') || polls.find((p) => /^AP/i.test(p.name || '')) || polls[0];
    const map = new Map((ap?.ranks || []).map((r) => [String(r.team?.id), r.current]));
    rankCache.set(key, { at: Date.now(), map });
    return map;
  };

  adapter.conferenceGroup = async (teamId) => {
    const ck = `${key}:${teamId}`;
    if (groupCache.has(ck)) return groupCache.get(ck);
    const res = await getJson(adapter.urls.team(teamId), { persist: true });
    const gid = res.json?.team?.groups?.id || null;
    groupCache.set(ck, gid);
    return gid;
  };

  adapter.scoreboard = async (dateKey, ctx = {}) => {
    const favIds = new Set((ctx.favoriteTeamIds || []).map(String));
    const params = lg.allGamesGroup && key === 'cfb' ? `&groups=${lg.allGamesGroup}&limit=300` : '';
    const [main, ap] = await Promise.all([
      adapter.fetchScoreboard(dateKey, params, ctx),
      adapter.apRanks().catch(() => new Map()),
    ]);
    const byId = new Map(main.games.map((g) => [g.id, g]));
    let stale = main.stale;

    if (lg.tournamentGroup && inTournamentWindow(dateKey)) {
      const t = await adapter.fetchScoreboard(dateKey, `&groups=${lg.tournamentGroup}&limit=100`, ctx).catch(() => null);
      for (const g of t?.games || []) byId.set(g.id, g);
      stale = stale || !!t?.stale;
    }

    // Make sure favorites' games are present even when unranked.
    for (const id of favIds) {
      const present = [...byId.values()].some((g) => g.home.id === id || g.away.id === id);
      if (present || key === 'cfb' || main.games.length === 0) continue;
      const gid = await adapter.conferenceGroup(id).catch(() => null);
      if (!gid) continue;
      const conf = await adapter.fetchScoreboard(dateKey, `&groups=${gid}&limit=100`, ctx).catch(() => null);
      for (const g of conf?.games || []) {
        if (g.home.id === id || g.away.id === id) byId.set(g.id, g);
      }
    }

    const games = [];
    for (const g of byId.values()) {
      g.home.rank = ap.get(g.home.id) || null;
      g.away.rank = ap.get(g.away.id) || null;
      g.tournament = isNcaaTournament(g);
      const keep = g.tournament || g.home.rank || g.away.rank || favIds.has(g.home.id) || favIds.has(g.away.id);
      if (keep) games.push(g);
    }
    return { games, at: main.at, stale };
  };

  return adapter;
}
