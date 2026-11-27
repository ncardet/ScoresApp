// Walk a league's history chronologically, maintaining Elo ratings and a per-team history so
// any rating can be read "as of" a date (point-in-time features for the backtest).

import { update, regress, params } from '../../site/js/predict/elo.js';

export class EloBook {
  constructor(league) {
    this.league = league;
    this.p = params(league);
    this.r = new Map(); // teamId -> rating
    this.hist = new Map(); // teamId -> [{day, r}] (rating after each game, plus season resets)
    this.names = new Map();
    this.season = null;
    this.seasonsSeen = 0;
    this.lastDay = null;
  }

  rating(id) {
    if (this.r.has(id)) return this.r.get(id);
    // Unseen team after the first season: promoted / new club (soccer), FCS etc. (college).
    return this.seasonsSeen > 1 && this.p.newTeam ? this.p.newTeam : this.p.mean;
  }

  push(id, day, r) {
    if (!this.hist.has(id)) this.hist.set(id, []);
    this.hist.get(id).push({ day, r });
  }

  startSeason(season, day) {
    if (season === this.season) return;
    if (this.season !== null) {
      for (const [id, r] of this.r) {
        const nr = regress(r, this.league);
        this.r.set(id, nr);
        this.push(id, day, nr);
      }
    }
    this.season = season;
    this.seasonsSeen++;
  }

  /** Rating before `day` (exclusive), i.e. what was known going into that day. */
  asOf(id, day) {
    const h = this.hist.get(id);
    if (!h?.length) return this.rating(id);
    let lo = 0;
    let hi = h.length - 1;
    if (h[0].day >= day) return this.seasonsSeen > 1 && this.p.newTeam ? this.p.newTeam : this.p.mean;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (h[mid].day < day) lo = mid; else hi = mid - 1;
    }
    return h[lo].r;
  }

  /** Apply a completed game. Returns the pre-game ratings. */
  apply(g) {
    const pre = { home: this.rating(g.h.id), away: this.rating(g.a.id) };
    this.names.set(g.h.id, g.h.n);
    this.names.set(g.a.id, g.a.n);
    if (!g.done || g.x || g.h.s == null || g.a.s == null) return pre;
    let winner = null;
    if (g.h.s === g.a.s && (g.h.w || g.a.w)) winner = g.h.w ? 'home' : 'away'; // shootout / OT decided ties
    const res = update(pre.home, pre.away, g.h.s, g.a.s, this.league, { neutral: g.neutral, winner });
    this.r.set(g.h.id, res.home);
    this.r.set(g.a.id, res.away);
    this.push(g.h.id, g.day, res.home);
    this.push(g.a.id, g.day, res.away);
    this.lastDay = g.day;
    return pre;
  }

  /** League-wide percentile of a rating among teams that have played this season. */
  percentile(rating, day, activeIds) {
    const vals = [...activeIds].map((id) => this.asOf(id, day)).sort((a, b) => a - b);
    if (!vals.length) return 0.5;
    let n = 0;
    for (const v of vals) if (v <= rating) n++;
    return n / vals.length;
  }

  toJSON() {
    const ratings = {};
    for (const [id, r] of this.r) ratings[id] = { r: Math.round(r * 10) / 10, n: this.names.get(id) || '' };
    return { league: this.league, season: this.season, updated: this.lastDay, params: this.p, ratings };
  }
}

/**
 * Walk histories (one or more leagues sharing a pool) and call `onGame(g, pre, book)` before
 * each game is applied. Returns the book.
 */
export function walk(league, histories, { onGame } = {}) {
  const book = new EloBook(league);
  const seasons = new Map();
  for (const { season, games } of histories) {
    if (!seasons.has(season)) seasons.set(season, []);
    seasons.get(season).push(...games);
  }
  for (const season of [...seasons.keys()].sort((a, b) => a - b)) {
    const games = seasons.get(season).sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
    if (!games.length) continue;
    book.startSeason(season, games[0].day);
    for (const g of games) {
      const pre = { home: book.rating(g.h.id), away: book.rating(g.a.id) };
      if (onGame) onGame(g, pre, book);
      book.apply(g);
    }
  }
  return book;
}
