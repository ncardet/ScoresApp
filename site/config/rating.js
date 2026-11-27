// Excitement rating: weights, thresholds and per-sport constants. Tune here.
//
// How a rating is made (details in README "Excitement rating"):
//   1. Each component is measured on the game and normalised to 0..1.
//   2. The weighted average of components is the game's raw score.
//   3. The raw score is placed as a percentile among past games of the same league
//      (site/data/calibration/<league>.json), then mapped to 0..100 with `curve`.
// Changing weights is safe: calibration files store raw component values and the
// distribution is recomputed in the browser with the current weights.

export default {
  // Bump when the maths changes, so cached final ratings are recomputed.
  version: 4,

  bands: [
    { min: 85, key: 'great', label: 'Great' },
    { min: 65, key: 'good', label: 'Good' },
    { min: 40, key: 'ok', label: 'OK' },
    { min: 0, key: 'dull', label: 'Dull' },
  ],

  // Percentile -> rating. 50th percentile = 50; 87.5th = 85, so ~12.5% of games are Great.
  curve: [[0, 0], [0.5, 50], [0.875, 85], [1, 100]],

  // In-game component weights (normalised by their sum).
  weights: {
    swing: 0.29,        // Game Excitement Index: sum of |change in win probability|, length-normalised
    closeness: 0.16,    // share of the final 20% of the game spent close
    leadChanges: 0.10,  // lead changes and ties, late ones weighted more
    comeback: 0.17,     // how low the winner's (or current leader's) win probability got
    novelty: 0.16,      // overtime, walk-offs, no-hitters, hat tricks, 40-point games, red cards...
    pace: 0.04,         // scoring / shots vs league norm
    stakes: 0.19,       // playoffs, elimination, rivalry, ranked matchup (scaled by competitiveness)
    quality: 0.06,      // team quality (records / AP ranks): two good teams beat two bad ones
  },
  // Amplifiers multiply the weighted in-game score by (1 + a x value): stakes (0..1, already
  // scaled by how competitive the game was) and centred team quality (-1..1). Tuned on the
  // labeled fixtures with calibration rebuilt from the backfill (scripts/tune-rating.mjs --search).
  amplifiers: { stakes: 0.37, qualityC: 0.02 },

  comebackLateness: 0.64,     // comeback counts (1 - x) + x * t, t = when the winner's deepest hole came
  soccerCloseTrust: 0.6,      // soccer: "within a goal" is the norm, so late closeness counts this much

  swingResample: 0.005,       // sample win probability every 0.5% of regulation (0 = every play)
  swingLateBoost: 2.24,          // a swing at time t (0..1) counts 1 + boost * t^2 (0 = textbook GEI)
  lateSwingCredit: 0,         // swing >= this x (final-tenth swing / its league 95th percentile); tried, off
  compLate: false,            // judge competitiveness (for the amplifiers) on late swing only; tried, off
  lateWindow: 0.2,            // "late" = final 20% of regulation (plus any overtime)
  closeWp: [0.3, 0.7],        // win probability band that counts as close
  leadChangeLateBoost: 2,     // a lead change at time t (0..1) counts 1 + boost * t^2
  maxSwingExtrapolation: 4,   // live: cap on T_reg / T_elapsed while the game is young

  // Novelty flags: each adds its weight, the component is capped at 1.
  novelty: {
    overtime: 0.45,          // per OT period, first one; later ones add `extraOvertime`
    extraOvertime: 0.2,
    extraInnings: 0.4,
    shootout: 0.3,           // NHL shootout
    penalties: 0.55,         // soccer penalty shootout
    noHitterLive: 0.8,       // no-hitter in progress after the 6th
    noHitter: 1.0,
    hatTrick: 0.35,
    fortyPoints: 0.3,        // 40+ point individual game (basketball)
    fiftyPoints: 0.5,
    walkOff: 0.55,
    lateWinner: 0.4,         // go-ahead score in the final ~1% of regulation or in OT
    redCard: 0.18,           // per red card, max 2 counted
    bigComeback: 0.5,        // 15+ (basketball) or 17+ (football) point comeback
    // League-only flags (see leagueNovelty): rare in the WNBA, routine in the NBA.
    lateComeback: 0.55,      // overturned a deficit of lateComebackPoints+ in the final minute
    tripleDouble: 0.3,
    twentyTwenty: 0.3,       // 20 points and 20 rebounds
  },
  // Points down for a "big comeback": per league first, then per sport (WNBA: 12+, NBA: 15+).
  bigComebackPoints: { basketball: 15, football: 17, wnba: 12 },
  lateComebackPoints: { wnba: 7 },
  leagueNovelty: { wnba: ['lateComeback', 'tripleDouble', 'twentyTwenty'] },

  // Live: rating = (1 - a) * predicted + a * in-game, a = progress ^ gamma (progress 0..1).
  // gamma 1.2: in-game evidence weighs ~18% a quarter of the way in, ~43% at half, ~77% at 80%.
  live: { gamma: 1.2 },

  // Pre-game prediction.
  prior: {
    weights: { closeness: 0.42, quality: 0.22, rivalry: 0.1, stakes: 0.18, ranked: 0.08 },
    // Predicted = 50 + spread * (calibrated prior - 50). < 1 because pre-game is less certain.
    spread: 0.85,
    min: 5,
    max: 97,
  },

  // Per-sport model constants.
  sports: {
    basketball: { kind: 'margin' },
    football: { kind: 'margin' },
    hockey: { kind: 'poisson', otHomeEdge: 0.52 },
    soccer: { kind: 'poisson' },
    baseball: { kind: 'runs' },
  },

  // Per-league constants: margin SD over regulation (margin model), goals/runs per game,
  // shot norms (pace), and default component scales used until calibration exists
  // (scale = roughly the 95th percentile of the raw component).
  leagues: {
    nfl: { sigma: 13.5, totalNorm: 45, scales: { swing: 4.6, leadChanges: 9, pace: 1.6 } },
    cfb: { sigma: 16, totalNorm: 55, scales: { swing: 4.6, leadChanges: 9, pace: 1.6 } },
    nba: { sigma: 13, totalNorm: 228, scales: { swing: 6.5, leadChanges: 30, pace: 1.18 } },
    wnba: { sigma: 11, totalNorm: 164, scales: { swing: 6.5, leadChanges: 24, pace: 1.2 } },
    mcbb: { sigma: 11, totalNorm: 145, scales: { swing: 5.5, leadChanges: 22, pace: 1.3 } },
    wcbb: { sigma: 11.5, totalNorm: 135, scales: { swing: 5.5, leadChanges: 22, pace: 1.3 } },
    mlb: { runsPerTeam: 4.4, totalNorm: 8.8, scales: { swing: 3.6, leadChanges: 6, pace: 2.0 } },
    nhl: { goalsPerTeam: 3.1, totalNorm: 6.2, shotNorm: 58, scales: { swing: 2.6, leadChanges: 6, pace: 1.6 } },
    epl: { goalsPerGame: 2.85, totalNorm: 2.85, shotNorm: 25, scales: { swing: 2.2, leadChanges: 5, pace: 1.9 } },
    ucl: { goalsPerGame: 3.1, totalNorm: 3.1, shotNorm: 25, scales: { swing: 2.2, leadChanges: 5, pace: 1.9 } },
    uel: { goalsPerGame: 2.9, totalNorm: 2.9, shotNorm: 25, scales: { swing: 2.2, leadChanges: 5, pace: 1.9 } },
    mls: { goalsPerGame: 3.0, totalNorm: 3.0, shotNorm: 25, scales: { swing: 2.2, leadChanges: 5, pace: 1.9 } },
    nwsl: { goalsPerGame: 2.7, totalNorm: 2.7, shotNorm: 24, scales: { swing: 2.2, leadChanges: 5, pace: 1.9 } },
    wsl: { goalsPerGame: 3.0, totalNorm: 3.0, shotNorm: 24, scales: { swing: 2.2, leadChanges: 5, pace: 1.9 } },
  },

  // Used only if a league has no calibration file: raw score -> percentile via a normal curve.
  fallbackDistribution: { median: 0.36, spread: 0.11 },

  // Rivalries by league: pairs of ESPN team ids. Add your own.
  rivalries: {
    nfl: [['13', '12'], ['13', '7'], ['13', '24'], ['13', '14']], // Raiders v Chiefs, Broncos, Chargers, Rams
    nba: [['13', '2'], ['13', '12'], ['13', '9']],               // Lakers v Celtics, Clippers, Warriors
    mlb: [['19', '26'], ['19', '25'], ['19', '3'], ['10', '2']],  // Dodgers v Giants, Padres, Angels; Yankees v Red Sox
    nhl: [['8', '25'], ['8', '18'], ['8', '37']],                // Kings v Ducks, Sharks, Golden Knights
    cfb: [['30', '26'], ['30', '87'], ['194', '130'], ['333', '2']], // USC v UCLA, Notre Dame; Ohio St v Michigan; Alabama v Auburn
    mcbb: [['30', '26'], ['150', '153']],                        // USC v UCLA; Duke v UNC
    wcbb: [['30', '26']],
    epl: [['364', '368'], ['364', '360'], ['364', '382'], ['359', '367']], // Liverpool v Everton, Man Utd, Man City; Arsenal v Spurs
    mls: [['18966', '187']],                                     // LAFC v LA Galaxy (El Trafico)
    nwsl: [['21422', '21423']],                                  // Angel City v San Diego Wave
  },

  // F1 race rating weights (race only; other sessions are not rated).
  f1: {
    // On-track passes and neutralisations carry the most weight; tuned on the labeled races with
    // every component kept meaningful (scripts/tune-rating.mjs --f1, constrained).
    weights: { leadChanges: 0.06, overtakes: 0.3, finalGap: 0.2, incidents: 0.26, stakes: 0.08, charge: 0.05 },
    scales: { leadChanges: 6, overtakes: 120 },
    closeGapSeconds: 1.5,
    chargeNorm: 10,             // places gained by a podium finisher after lap 1 for a full "charge"
    // Circuits where passing is easy/hard nudge the pre-race prediction (substring match).
    overtakingCircuits: { up: ['Las Vegas', 'Interlagos', 'Bahrain', 'Shanghai', 'Spa', 'Baku', 'Jeddah', 'Miami', 'Austin'], down: ['Monaco', 'Hungaroring', 'Marina Bay', 'Zandvoort', 'Imola'] },
  },
};
