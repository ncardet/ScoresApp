// Orders for Today's game lists. Entries are { game, rating, ... } as built by the Today view.

/** Games still to come first, soonest at the top; finished and cancelled games after, in start order. */
export function byGameTime(a, b) {
  const done = (e) => (e.game.state === 'post' || e.game.canceled ? 1 : 0);
  return done(a) - done(b) || new Date(a.game.start) - new Date(b.game.start);
}
