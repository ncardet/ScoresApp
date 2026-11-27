// Look Ahead's off-season lines: one per league with nothing in the next 14 days ("WNBA returns
// May 15", "WNBA: off-season"), from predictions.json `offSeason` (written by the nightly job).

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "May 15", or "Feb 19, 2027" when it's not this year. */
export function returnsLabel(day, today) {
  const [y, m, d] = day.split('-').map(Number);
  return `${MONTHS[m - 1]} ${d}${today && +today.slice(0, 4) === y ? '' : `, ${y}`}`;
}

/**
 * @param {Record<string, {returns: string|null, preseason?: boolean, event?: string, inSeason?: boolean}>} offSeason
 * @param {{key: string, short: string, sport: string}[]} leagues the leagues to show (enabled, in order)
 * @param {string} today YYYY-MM-DD
 * @returns {{league: string, sport: string, text: string}[]}
 */
export function offSeasonLines(offSeason, leagues, today) {
  return leagues.filter((l) => offSeason?.[l.key]).map((l) => {
    const o = offSeason[l.key];
    const text = o.returns
      ? `${l.short} returns ${returnsLabel(o.returns, today)}${o.preseason ? ' (preseason)' : o.event ? ` (${o.event})` : ''}`
      : o.inSeason ? `${l.short}: nothing in the next 14 days` : `${l.short}: off-season`;
    return { league: l.key, sport: l.sport, text };
  });
}
