// League registry: one entry per league the app covers.
// `espn` is the ESPN sport/league slug used by the adapters.
// Timing fields describe regulation so the rating engine can normalise game length.

export const LEAGUES = [
  {
    key: 'nfl', name: 'NFL', short: 'NFL', sport: 'football', espn: 'football/nfl',
    periods: 4, periodMinutes: 15, otMinutes: 10, periodLabel: 'Q', oneScore: 8,
  },
  {
    key: 'cfb', name: 'College Football', short: 'CFB', sport: 'football', espn: 'football/college-football',
    periods: 4, periodMinutes: 15, otMinutes: 15, periodLabel: 'Q', oneScore: 8, college: true,
    // ESPN "groups" id for all FBS games.
    allGamesGroup: 80,
  },
  {
    key: 'nba', name: 'NBA', short: 'NBA', sport: 'basketball', espn: 'basketball/nba',
    periods: 4, periodMinutes: 12, otMinutes: 5, periodLabel: 'Q', oneScore: 3,
  },
  {
    // May to October. 40-minute games (4 x 10), 5-minute overtime.
    key: 'wnba', name: 'WNBA', short: 'WNBA', sport: 'basketball', espn: 'basketball/wnba',
    periods: 4, periodMinutes: 10, otMinutes: 5, periodLabel: 'Q', oneScore: 3,
  },
  {
    key: 'mcbb', name: "Men's College Basketball", short: 'MCBB', sport: 'basketball',
    espn: 'basketball/mens-college-basketball',
    periods: 2, periodMinutes: 20, otMinutes: 5, periodLabel: 'H', oneScore: 3, college: true,
    allGamesGroup: 50, tournamentGroup: 100,
  },
  {
    key: 'wcbb', name: "Women's College Basketball", short: 'WCBB', sport: 'basketball',
    espn: 'basketball/womens-college-basketball',
    periods: 4, periodMinutes: 10, otMinutes: 5, periodLabel: 'Q', oneScore: 3, college: true,
    allGamesGroup: 50, tournamentGroup: 100,
  },
  {
    key: 'mlb', name: 'MLB', short: 'MLB', sport: 'baseball', espn: 'baseball/mlb',
    periods: 9, periodLabel: 'Inn', oneScore: 2,
  },
  {
    key: 'nhl', name: 'NHL', short: 'NHL', sport: 'hockey', espn: 'hockey/nhl',
    periods: 3, periodMinutes: 20, otMinutes: 5, periodLabel: 'P', oneScore: 1,
  },
  {
    key: 'epl', name: 'Premier League', short: 'EPL', sport: 'soccer', espn: 'soccer/eng.1',
    periods: 2, periodMinutes: 45, otMinutes: 15, oneScore: 1,
  },
  {
    key: 'ucl', name: 'Champions League', short: 'UCL', sport: 'soccer', espn: 'soccer/uefa.champions',
    periods: 2, periodMinutes: 45, otMinutes: 15, oneScore: 1, knockouts: true,
  },
  {
    key: 'uel', name: 'Europa League', short: 'UEL', sport: 'soccer', espn: 'soccer/uefa.europa',
    periods: 2, periodMinutes: 45, otMinutes: 15, oneScore: 1, knockouts: true,
  },
  {
    key: 'mls', name: 'MLS', short: 'MLS', sport: 'soccer', espn: 'soccer/usa.1',
    periods: 2, periodMinutes: 45, otMinutes: 15, oneScore: 1,
  },
  {
    key: 'nwsl', name: 'NWSL', short: 'NWSL', sport: 'soccer', espn: 'soccer/usa.nwsl',
    periods: 2, periodMinutes: 45, otMinutes: 15, oneScore: 1,
  },
  {
    key: 'wsl', name: "Women's Super League", short: 'WSL', sport: 'soccer', espn: 'soccer/eng.w.1',
    periods: 2, periodMinutes: 45, otMinutes: 15, oneScore: 1,
  },
  {
    key: 'f1', name: 'Formula 1', short: 'F1', sport: 'racing', espn: 'racing/f1',
  },

  // ---- Optional leagues: off until switched on in Settings → Optional leagues. ----
  // They never reach the morning brief unless config/prediction.json brief.includeOptional is on.
  {
    key: 'seriea', name: 'Serie A', short: 'Serie A', sport: 'soccer', espn: 'soccer/ita.1', optional: true,
    note: 'Soccer model · Paramount+',
    periods: 2, periodMinutes: 45, otMinutes: 15, oneScore: 1,
  },
  {
    key: 'uecl', name: 'Conference League', short: 'UECL', sport: 'soccer', espn: 'soccer/uefa.europa.conf', optional: true,
    note: 'Soccer model · Paramount+',
    periods: 2, periodMinutes: 45, otMinutes: 15, oneScore: 1, knockouts: true,
  },
  {
    key: 'uwcl', name: "Women's Champions League", short: 'UWCL', sport: 'soccer', espn: 'soccer/uefa.wchampions', optional: true,
    note: 'Soccer model · Paramount+',
    periods: 2, periodMinutes: 45, otMinutes: 15, oneScore: 1, knockouts: true,
  },
  {
    // ESPN has only the finishing order (no lead changes, cautions or margin), so: schedule + results.
    key: 'nascar', name: 'NASCAR Cup Series', short: 'NASCAR', sport: 'racing', espn: 'racing/nascar-premier', optional: true,
    scheduleOnly: true, standings: false, noGamePage: true, note: 'Schedule and results, not rated: ESPN has no lap data',
  },
  {
    // The four Grand Slams, singles. ESPN's ATP feed carries both singles draws at the majors.
    key: 'tennis', name: 'Tennis Grand Slams', short: 'Tennis', sport: 'tennis', espn: 'tennis/atp', optional: true,
    standings: false, noGamePage: true, note: 'Grand Slams, singles · rated on sets and tiebreaks',
  },
  {
    key: 'ufc', name: 'UFC', short: 'UFC', sport: 'mma', espn: 'mma/ufc', optional: true,
    scheduleOnly: true, standings: false, noGamePage: true, note: 'Schedule only · Paramount+',
  },
];

/** The leagues that are always available (switch one off in Settings → Leagues). */
export const CORE_LEAGUES = LEAGUES.filter((l) => !l.optional);
/** Leagues the user switches on in Settings → Optional leagues (all off by default). */
export const OPTIONAL_LEAGUES = LEAGUES.filter((l) => l.optional);

export const LEAGUE_BY_KEY = Object.fromEntries(LEAGUES.map((l) => [l.key, l]));

export function league(key) {
  const l = LEAGUE_BY_KEY[key];
  if (!l) throw new Error(`Unknown league: ${key}`);
  return l;
}

/** Regulation length in minutes (soccer 90, NBA 48, ...). Baseball uses innings, so null. */
export function regulationMinutes(l) {
  return l.periodMinutes ? l.periods * l.periodMinutes : null;
}
