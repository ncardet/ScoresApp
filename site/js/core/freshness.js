// Which copy of a game's status to trust. The scoreboard and a game's summary are fetched at
// different times, so either can be the older one. A game only ever moves forward:
// scheduled -> live -> final.

const RANK = { pre: 0, in: 1, post: 2 };

export const stateRank = (state) => RANK[state] ?? 0;

/** A summary's status replaces the scoreboard's only when it's further along, never backwards. */
export function summaryIsAhead(game, summaryGame) {
  return !!summaryGame?.state && stateRank(summaryGame.state) > stateRank(game?.state);
}

/**
 * Is a saved summary still good enough for this game? It's judged by the summary's own state (a
 * copy taken while live expires like a live one), and never when the scoreboard is already past it
 * (a live copy of a game that has ended).
 * @param {{detail: object, at: number}|undefined} saved
 */
export function summaryFresh(saved, game, now, { liveTtl, finalTtl, otherTtl }) {
  if (!saved) return false;
  const state = saved.detail?.game?.state;
  if (state && stateRank(state) < stateRank(game?.state)) return false;
  const ttl = state === 'in' ? liveTtl : state === 'post' ? finalTtl : otherTtl;
  return now - saved.at < ttl;
}
