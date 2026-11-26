// Builds an ESPN-backed adapter for one league. Per-league files in site/js/adapters/ call
// espnLeague(key) and override whatever that league needs; nothing outside site/js/adapters/
// knows ESPN URLs or JSON shapes.

import { getJson } from './client.js';
import { parseEvent } from './parse.js';
import { parseSummary } from './summary.js';
import { parseStandings } from './standings.js';
import { espnDate } from '../../core/time.js';
import { LEAGUE_BY_KEY } from '../../core/leagues.js';

export const SITE = 'https://site.api.espn.com/apis/site/v2/sports';
export const SITE_V2 = 'https://site.api.espn.com/apis/v2/sports';
export const CORE = 'https://sports.core.api.espn.com/v2/sports';

/**
 * @typedef {object} Adapter
 * @property {string} key
 * @property {(dateKey: string, ctx?: object) => Promise<{games: object[], at: number, stale: boolean}>} scoreboard
 * @property {(game: object, ctx?: object) => Promise<object>} summary   GameDetail
 * @property {(ctx?: object) => Promise<object>} standings
 */

export function espnLeague(key, overrides = {}) {
  const lg = LEAGUE_BY_KEY[key];
  const base = `${SITE}/${lg.espn}`;
  const [sportSlug, leagueSlug] = lg.espn.split('/');

  /** @type {Adapter} */
  const adapter = {
    key,
    league: lg,
    urls: {
      scoreboard: (dateKey, params = '') => `${base}/scoreboard?dates=${espnDate(dateKey)}${params}`,
      summary: (id) => `${base}/summary?event=${id}`,
      standings: (params = '') => `${SITE_V2}/${lg.espn}/standings${params}`,
      rankings: () => `${base}/rankings`,
      team: (id) => `${base}/teams/${id}`,
      coreTeamStats: (eventId, teamId) =>
        `${CORE}/${sportSlug}/leagues/${leagueSlug}/events/${eventId}/competitions/${eventId}/competitors/${teamId}/statistics`,
    },

    /** Raw scoreboard fetch -> parsed games. */
    async fetchScoreboard(dateKey, params = '', ctx = {}) {
      const res = await getJson(adapter.urls.scoreboard(dateKey, params), { persist: !!ctx.persist });
      const games = (res.json?.events || []).map((e) => parseEvent(e, key));
      return { games, at: res.at, stale: res.stale };
    },

    async scoreboard(dateKey, ctx = {}) {
      return adapter.fetchScoreboard(dateKey, '', ctx);
    },

    async summary(game, ctx = {}) {
      const res = await getJson(adapter.urls.summary(game.id), { persist: !!ctx.persist });
      const detail = parseSummary(res.json, key, game);
      detail.fetchedAt = res.at;
      detail.stale = res.stale;
      if (lg.sport === 'soccer' && ctx.advanced !== false && detail.game.state !== 'pre') {
        detail.soccer.advanced = await adapter.soccerAdvanced(detail.game).catch(() => null);
        if (detail.soccer.advanced) {
          const { home, away } = detail.soccer.advanced;
          if (home?.expectedGoals != null && away?.expectedGoals != null) {
            detail.soccer.xg = { home: home.expectedGoals, away: away.expectedGoals };
          }
        }
      }
      return detail;
    },

    /** Soccer: team xG and advanced stats from ESPN's core API (two small requests). */
    async soccerAdvanced(game) {
      if (!game?.home?.id || !game?.away?.id) return null;
      const one = async (teamId) => {
        const res = await getJson(adapter.urls.coreTeamStats(game.id, teamId), { timeout: 8000, retries: 0, persist: true });
        const out = {};
        for (const cat of res.json?.splits?.categories || []) {
          for (const s of cat.stats || []) {
            if (s.value != null) out[s.name] = s.value;
          }
        }
        return out;
      };
      const [home, away] = await Promise.all([one(game.home.id), one(game.away.id)]);
      return Object.keys(home).length || Object.keys(away).length ? { home, away } : null;
    },

    /** All teams in the league (for adding favorites). */
    async teams() {
      const res = await getJson(`${base}/teams?limit=1000`, { persist: true });
      const list = res.json?.sports?.[0]?.leagues?.[0]?.teams || [];
      return list.map(({ team: t }) => ({
        id: String(t.id),
        name: t.displayName,
        short: t.shortDisplayName || t.name,
        abbr: t.abbreviation,
        logo: t.logos?.[0]?.href || '',
      })).sort((a, b) => a.name.localeCompare(b.name));
    },

    async standings(ctx = {}) {
      const res = await getJson(adapter.urls.standings(ctx.params || ''), { persist: true });
      const parsed = parseStandings(res.json);
      // Some leagues roll over to next season before it starts (e.g. MLS in November):
      // if nobody has played yet, show the previous season instead.
      const played = parsed.groups.some((g) => g.rows.some((r) => (r.stats.gamesPlayed?.v || r.stats.wins?.v || 0) > 0));
      if (!played && !ctx.params && parsed.seasonYear) {
        const prev = await getJson(adapter.urls.standings(`?season=${parsed.seasonYear - 1}`), { persist: true }).catch(() => null);
        if (prev?.json) {
          const p = parseStandings(prev.json);
          if (p.groups.length) return { ...p, at: prev.at, stale: prev.stale };
        }
      }
      return { ...parsed, at: res.at, stale: res.stale };
    },

    ...overrides,
  };
  return adapter;
}
