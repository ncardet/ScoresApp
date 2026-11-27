// Scoring environment: how many points/goals/runs a team's games produce, as a z-score across
// the league. Two high-scoring teams make a more eventful game (NBA pace, soccer "open" sides,
// NHL and MLB run environments). Used by the nightly job and the backtest (point in time).

/**
 * @param {Array<{day: string, done: boolean, h: {id: string, s?: number}, a: {id: string, s?: number}}>} games
 *   season games in date order (compact history format)
 * @param {{before?: string, minGames?: number, minTeams?: number}} [opts] only games before this day
 * @returns {Map<string, number>|null} team id -> z-score of total scoring in its games
 */
export function scoringStyle(games, { before = null, minGames = 5, minTeams = 10 } = {}) {
  const tot = new Map();
  for (const g of games) {
    if (before && g.day >= before) break;
    if (!g.done || g.h?.s == null || g.a?.s == null) continue;
    const t = Number(g.h.s) + Number(g.a.s);
    if (!Number.isFinite(t)) continue;
    for (const id of [g.h.id, g.a.id]) {
      const v = tot.get(id) || [0, 0];
      v[0] += t;
      v[1]++;
      tot.set(id, v);
    }
  }
  const avgs = [...tot.entries()].filter(([, v]) => v[1] >= minGames).map(([id, v]) => [id, v[0] / v[1]]);
  if (avgs.length < minTeams) return null;
  const m = avgs.reduce((s, x) => s + x[1], 0) / avgs.length;
  const sd = Math.sqrt(avgs.reduce((s, x) => s + (x[1] - m) ** 2, 0) / avgs.length) || 1;
  return new Map(avgs.map(([id, v]) => [id, (v - m) / sd]));
}
