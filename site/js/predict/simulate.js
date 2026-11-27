// Monte Carlo season simulation and game importance.
//
// Each run plays every remaining regular-season game with Elo win/draw probabilities, ranks the
// table (random tiebreaks) and records each team's outcomes (playoffs, top seed, title, top four,
// relegation...). A game's importance for a team is the swing in those odds between winning and
// losing it, |P(outcome | win) - P(outcome | loss)|, weighted by outcome and summed over both teams.

import { probabilities } from './elo.js';

/**
 * League formats. `outcomes`: [{key, weight, test(rankInGroup, team, ctx)}] evaluated per team.
 * groupBy: which grouping ranks are computed within ('conf', 'div', 'all').
 */
export const FORMATS = {
  nfl: { points: 'winpct', outcomes: [
    { key: 'playoffs', label: 'playoff', weight: 1, kind: 'nflPlayoff' },
    { key: 'seed1', label: 'No. 1 seed', weight: 0.5, kind: 'confRank', n: 1 },
  ] },
  nba: { points: 'winpct', outcomes: [
    { key: 'top6', label: 'playoff', weight: 1, kind: 'confRank', n: 6 },
    { key: 'playin', label: 'play-in', weight: 0.5, kind: 'confRank', n: 10 },
    { key: 'seed1', label: 'No. 1 seed', weight: 0.3, kind: 'confRank', n: 1 },
  ] },
  nhl: { points: 'nhl', outcomes: [
    { key: 'playoffs', label: 'playoff', weight: 1, kind: 'nhlPlayoff' },
  ] },
  mlb: { points: 'winpct', outcomes: [
    { key: 'playoffs', label: 'playoff', weight: 1, kind: 'mlbPlayoff' },
    { key: 'division', label: 'division title', weight: 0.5, kind: 'divRank', n: 1 },
  ] },
  epl: { points: 'soccer', outcomes: [
    { key: 'title', label: 'title', weight: 1, kind: 'allRank', n: 1 },
    { key: 'top4', label: 'top-four', weight: 0.7, kind: 'allRank', n: 4 },
    { key: 'relegation', label: 'relegation', weight: 1, kind: 'allBottom', n: 3 },
  ] },
  wsl: { points: 'soccer', outcomes: [
    { key: 'title', label: 'title', weight: 1, kind: 'allRank', n: 1 },
    { key: 'top3', label: 'Champions League', weight: 0.7, kind: 'allRank', n: 3 },
    { key: 'relegation', label: 'relegation', weight: 1, kind: 'allBottom', n: 1 },
  ] },
  mls: { points: 'soccer', outcomes: [
    { key: 'playoffs', label: 'playoff', weight: 1, kind: 'confRank', n: 9 },
    { key: 'shield', label: "Supporters' Shield", weight: 0.5, kind: 'allRank', n: 1 },
  ] },
  nwsl: { points: 'soccer', outcomes: [
    { key: 'playoffs', label: 'playoff', weight: 1, kind: 'allRank', n: 8 },
    { key: 'shield', label: 'Shield', weight: 0.5, kind: 'allRank', n: 1 },
  ] },
  ucl: { points: 'soccer', outcomes: [
    { key: 'top8', label: 'top-eight', weight: 1, kind: 'allRank', n: 8 },
    { key: 'top24', label: 'knockout', weight: 0.8, kind: 'allRank', n: 24 },
  ] },
  uel: { points: 'soccer', outcomes: [
    { key: 'top8', label: 'top-eight', weight: 1, kind: 'allRank', n: 8 },
    { key: 'top24', label: 'knockout', weight: 0.8, kind: 'allRank', n: 24 },
  ] },
};

const NHL_OT_RATE = 0.23;

/** Standings from completed games: Map teamId -> {w, l, t, otl, pts, gp, gf, ga}. */
export function standingsFrom(games, league) {
  const tab = new Map();
  const get = (id) => {
    if (!tab.has(id)) tab.set(id, { w: 0, l: 0, t: 0, otl: 0, pts: 0, gp: 0, gf: 0, ga: 0 });
    return tab.get(id);
  };
  for (const g of games) {
    if (!g.done || g.x || g.h.s == null || g.a.s == null) continue;
    const h = get(g.h.id);
    const a = get(g.a.id);
    h.gp++; a.gp++;
    h.gf += g.h.s; h.ga += g.a.s; a.gf += g.a.s; a.ga += g.h.s;
    let hw = g.h.s > g.a.s;
    let aw = g.a.s > g.h.s;
    if (!hw && !aw && (g.h.w || g.a.w)) { hw = !!g.h.w; aw = !!g.a.w; }
    const ot = league === 'nhl' && (g.period > 3 || /OT|SO/.test(g.detail || ''));
    if (hw) { h.w++; if (ot) a.otl++; else a.l++; } else if (aw) { a.w++; if (ot) h.otl++; else h.l++; } else { h.t++; a.t++; }
  }
  for (const s of tab.values()) {
    s.pts = league === 'nhl' ? 2 * s.w + s.otl : 3 * s.w + s.t;
  }
  return tab;
}

function score(s, kind) {
  if (kind === 'winpct') return s.gp ? (s.w + 0.5 * s.t) / s.gp : 0.5;
  if (kind === 'nhl') return s.pts;
  return s.pts * 1000 + (s.gf - s.ga);
}

/**
 * Run the simulation.
 * @param {object} o
 * @param {string} o.league
 * @param {Map<string, object>} o.table   current standings (standingsFrom)
 * @param {{h:string,a:string,neutral?:boolean,id:string}[]} o.remaining  unplayed regular-season games
 * @param {(id:string)=>number} o.rating  Elo rating lookup
 * @param {Map<string,{conf?:string, div?:string}>} [o.structure]
 * @param {Set<string>} [o.targets]  game ids to measure importance for
 * @param {number} [o.runs]
 * @returns {{odds: Map<string, object>, importance: Map<string, object>}}
 */
export function simulateSeason({ league, table, remaining, rating, structure = new Map(), targets = new Set(), runs = 10000, rng = Math.random }) {
  const fmt = FORMATS[league];
  if (!fmt) return { odds: new Map(), importance: new Map() };
  const teamIds = [...new Set([...table.keys(), ...remaining.flatMap((g) => [g.h, g.a])])];
  const idx = new Map(teamIds.map((id, i) => [id, i]));
  const T = teamIds.length;
  const O = fmt.outcomes.length;
  const base = teamIds.map((id) => ({ ...(table.get(id) || { w: 0, l: 0, t: 0, otl: 0, pts: 0, gp: 0, gf: 0, ga: 0 }) }));
  // Pre-compute game probabilities.
  const games = remaining.map((g) => {
    const p = probabilities(rating(g.h), rating(g.a), league, { neutral: !!g.neutral });
    return { h: idx.get(g.h), a: idx.get(g.a), ph: p.home, pd: p.draw, id: g.id, target: targets.has(g.id) };
  });
  const targetGames = games.filter((g) => g.target);
  const tIndex = new Map(targetGames.map((g, i) => [g.id, i]));
  // results[run * nT + i] = 0 home win, 1 draw, 2 away win
  const results = new Uint8Array(runs * targetGames.length);
  const outcomes = new Uint8Array(runs * T * O);
  const groups = (key) => {
    const m = new Map();
    teamIds.forEach((id, i) => {
      const k = key === 'all' ? 'all' : (structure.get(id)?.[key] || 'none');
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(i);
    });
    return [...m.values()];
  };
  const confGroups = groups('conf');
  const divGroups = groups('div');
  const allGroup = [teamIds.map((_, i) => i)];
  const st = base.map((s) => ({ ...s }));
  const sc = new Float64Array(T);

  for (let r = 0; r < runs; r++) {
    for (let i = 0; i < T; i++) Object.assign(st[i], base[i]);
    for (const g of games) {
      const u = rng();
      const H = st[g.h];
      const A = st[g.a];
      H.gp++; A.gp++;
      let res;
      if (u < g.ph) res = 0; else if (u < g.ph + g.pd) res = 1; else res = 2;
      if (res === 0) { H.w++; if (fmt.points === 'nhl' && rng() < NHL_OT_RATE) A.otl++; else A.l++; H.gf += 1; }
      else if (res === 2) { A.w++; if (fmt.points === 'nhl' && rng() < NHL_OT_RATE) H.otl++; else H.l++; A.gf += 1; }
      else { H.t++; A.t++; }
      if (g.target) results[r * targetGames.length + tIndex.get(g.id)] = res;
    }
    for (let i = 0; i < T; i++) {
      const s = st[i];
      s.pts = fmt.points === 'nhl' ? 2 * s.w + s.otl : 3 * s.w + s.t;
      sc[i] = score(s, fmt.points) + rng() * 1e-6;
    }
    const rankIn = (grp) => {
      const sorted = [...grp].sort((x, y) => sc[y] - sc[x]);
      const ranks = new Map();
      sorted.forEach((t, k) => ranks.set(t, k + 1));
      return ranks;
    };
    const confRank = new Map();
    for (const grp of confGroups) for (const [t, k] of rankIn(grp)) confRank.set(t, k);
    const divRank = new Map();
    for (const grp of divGroups) for (const [t, k] of rankIn(grp)) divRank.set(t, k);
    const allRank = new Map();
    for (const [t, k] of rankIn(allGroup[0])) allRank.set(t, k);

    // League-specific playoff rules.
    const nflPlayoff = new Set();
    const mlbPlayoff = new Set();
    const nhlPlayoff = new Set();
    if (fmt.outcomes.some((o) => o.kind === 'nflPlayoff' || o.kind === 'mlbPlayoff')) {
      const wildcards = fmt.outcomes.some((o) => o.kind === 'nflPlayoff') ? 3 : 3;
      for (const grp of confGroups) {
        const divWinners = grp.filter((t) => divRank.get(t) === 1);
        const rest = grp.filter((t) => divRank.get(t) !== 1).sort((x, y) => sc[y] - sc[x]).slice(0, wildcards);
        for (const t of [...divWinners, ...rest]) (fmt.outcomes.some((o) => o.kind === 'nflPlayoff') ? nflPlayoff : mlbPlayoff).add(t);
      }
    }
    if (fmt.outcomes.some((o) => o.kind === 'nhlPlayoff')) {
      for (const grp of confGroups) {
        const top3 = grp.filter((t) => divRank.get(t) <= 3);
        const rest = grp.filter((t) => divRank.get(t) > 3).sort((x, y) => sc[y] - sc[x]).slice(0, 2);
        for (const t of [...top3, ...rest]) nhlPlayoff.add(t);
      }
    }
    for (let i = 0; i < T; i++) {
      fmt.outcomes.forEach((o, k) => {
        let v = 0;
        switch (o.kind) {
          case 'confRank': v = confRank.get(i) <= o.n; break;
          case 'divRank': v = divRank.get(i) <= o.n; break;
          case 'allRank': v = allRank.get(i) <= o.n; break;
          case 'allBottom': v = allRank.get(i) > T - o.n; break;
          case 'nflPlayoff': v = nflPlayoff.has(i); break;
          case 'mlbPlayoff': v = mlbPlayoff.has(i); break;
          case 'nhlPlayoff': v = nhlPlayoff.has(i); break;
          default: v = 0;
        }
        outcomes[(r * T + i) * O + k] = v ? 1 : 0;
      });
    }
  }

  // Season odds per team.
  const odds = new Map();
  teamIds.forEach((id, i) => {
    const o = {};
    fmt.outcomes.forEach((oc, k) => {
      let n = 0;
      for (let r = 0; r < runs; r++) n += outcomes[(r * T + i) * O + k];
      o[oc.key] = n / runs;
    });
    odds.set(id, o);
  });

  // Importance per target game.
  const importance = new Map();
  targetGames.forEach((g, gi) => {
    const nT = targetGames.length;
    const perTeam = {};
    let total = 0;
    const detail = [];
    for (const [side, ti, winRes, lossRes] of [['home', g.h, 0, 2], ['away', g.a, 2, 0]]) {
      let teamSwing = 0;
      for (let k = 0; k < O; k++) {
        let nw = 0; let sw = 0; let nl = 0; let sl = 0;
        for (let r = 0; r < runs; r++) {
          const res = results[r * nT + gi];
          const v = outcomes[(r * T + ti) * O + k];
          if (res === winRes) { nw++; sw += v; } else if (res === lossRes) { nl++; sl += v; }
        }
        if (nw < 20 || nl < 20) continue;
        const d = Math.abs(sw / nw - sl / nl);
        const oc = fmt.outcomes[k];
        teamSwing += oc.weight * d;
        detail.push({ side, outcome: oc.key, label: oc.label, swing: d, pBefore: (sw + sl) / Math.max(1, nw + nl) });
      }
      perTeam[side] = teamSwing;
      total += teamSwing;
    }
    // Dead rubber: nothing much at stake for either team.
    const alive = (ti) => fmt.outcomes.some((oc) => {
      const p = odds.get(teamIds[ti])[oc.key];
      return p > 0.02 && p < 0.98;
    });
    detail.sort((a, b) => b.swing - a.swing);
    importance.set(g.id, {
      swing: total * 100, // percentage points, summed over both teams (weighted outcomes)
      home: perTeam.home * 100,
      away: perTeam.away * 100,
      top: detail[0] || null,
      dead: !alive(g.h) && !alive(g.a),
    });
  });
  return { odds, importance, teamIds };
}
