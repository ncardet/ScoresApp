# Endpoint probe report

Generated 2026-11-27T21:01:14.805Z with Origin `https://example.github.io`. Re-run: `npm run probe`.

**CORS:** every ESPN endpoint answered with `Access-Control-Allow-Origin: *` — the browser can call ESPN directly.

## Per-league availability

| League | Scoreboard | Summary | Standings | Rankings | Win prob. | Play-by-play | Lineups | xG | Broadcasts | Odds | Predictor |
|---|---|---|---|---|---|---|---|---|---|---|---|
| NFL | 200 ✓CORS | 200 ✓CORS | 200 ✓CORS | n/a | 180 | 179 (drives) | — | — | 16/16 games | 15/16 | — |
| College Football | 200 ✓CORS | 200 ✓CORS | 200 ✓CORS | 200 ✓CORS | 172 | 173 (drives) | — | — | 21/21 games | 21/21 | — |
| NBA | 200 ✓CORS | 200 ✓CORS | 200 ✓CORS | n/a | 479 | 479 (plays) | — | — | 9/11 games | 5/11 | — |
| WNBA | 200 ✓CORS | 200 ✓CORS | 200 ✓CORS | n/a | 374 | 374 (plays) | — | — | 1/1 games | 0/1 | — |
| Men's College Basketball | 200 ✓CORS | 200 ✓CORS | 200 ✓CORS | 200 ✓CORS | 404 | 405 (plays) | — | — | 11/11 games | 11/11 | — |
| Women's College Basketball | 200 ✓CORS | 200 ✓CORS | 200 ✓CORS | 200 ✓CORS | 439 | 443 (plays) | — | — | 2/2 games | 0/2 | — |
| MLB | 200 ✓CORS | 200 ✓CORS | 200 ✓CORS | n/a | 92 | 719 (plays) | 2 (no formation) | — | 1/1 games | 0/1 | — |
| NHL | 200 ✓CORS | 200 ✓CORS | 200 ✓CORS | n/a | — | 314 (plays) | — | — | 15/15 games | 15/15 | — |
| Premier League | 200 ✓CORS | 200 ✓CORS | 200 ✓CORS | n/a | — | commentary 98 | 2 (4-2-3-1 / 4-2-3-1) | team xG (core API) | 1/1 games | 1/1 | — |
| Champions League | 200 ✓CORS | 200 ✓CORS | 200 ✓CORS | n/a | — | commentary 91 | 2 (4-4-2 / 4-3-3) | team xG (core API) | 9/9 games | 9/9 | — |
| Europa League | 200 ✓CORS | 200 ✓CORS | 200 ✓CORS | n/a | — | commentary 125 | 2 (4-3-3 / 3-4-2-1) | team xG (core API) | 18/18 games | 18/18 | — |
| MLS | 200 ✓CORS | 200 ✓CORS | 200 ✓CORS | n/a | — | commentary 109 | 2 (4-1-4-1 / 4-1-4-1) | team xG (core API) | 2/2 games | 2/2 | — |
| NWSL | 200 ✓CORS | 200 ✓CORS | 200 ✓CORS | n/a | — | commentary 136 | 2 (4-1-4-1 / 4-2-3-1) | team xG (core API) | 1/1 games | 1/1 | — |
| Women's Super League | 200 ✓CORS | 200 ✓CORS | 200 ✓CORS | n/a | — | commentary 114 | 2 (4-2-3-1 / 4-4-2) | — | 5/5 games | 5/5 | — |
| Formula 1 | 200 ✓CORS | 404 ✓CORS | 200 ✓CORS | n/a | — | — | — | — | 1/1 games | 0/1 | — |

Counts are from the most recent finished game (summary) and the current scoreboard.

## Details

### NFL (`football/nfl`)

- Scoreboard now: 16 events {"pre":15,"post":1}, 281 KB, 453 ms
- Networks seen: CBS, Fox, NBC, Netflix, Prime Video, ESPN
- Finished game: Green Bay Packers at Los Angeles Rams (401873079, 2026-11-26T01:00Z) — summary 604 KB, 88 ms
- Summary keys: boxscore, format, gameInfo, drives, leaders, injuries, broadcasts, pickcenter, odds, againstTheSpread, scoringPlays, news, header, winprobability, article, videos, wallclockAvailable, meta, standings
- Win probability points: 180; plays: 179; scoring plays: 9; key events: 0; commentary: 0 (0 shots/goals)
- Team stats: firstDowns, firstDownsPassing, firstDownsRushing, firstDownsPenalty, thirdDownEff, fourthDownEff, totalOffensivePlays, totalYards, yardsPerPlay, totalDrives, netPassingYards, completionAttempts, yardsPerPass, interceptions, sacksYardsLost, rushingYards, rushingAttempts, yardsPerRushAttempt, redZoneAttempts, totalPenaltiesYards, turnovers, fumblesLost, interceptions, defensiveTouchdowns, possessionTime
- Box score players: yes; predictor: no; odds (pickcenter): 1; series: no; shot map flag: null
- Standings: 200, 2 groups / 32 rows (American Football Conference, National Football Conference)
- Standings stats: differential, gamesBehind, losses, playoffSeed, pointDifferential, pointsAgainst, pointsFor, streak, ties, winPercent, wins, divisionLosses, divisionRecord, divisionTies, divisionWins, lockedDivRank, overall, Home, Road, vs. Div., vs. Conf.

### College Football (`football/college-football`)

- Scoreboard now: 21 events {"pre":21}, 390 KB, 430 ms
- Networks seen: ESPN, CBS, ABC, ERADM, Fox, ESPN2, Disney+, SEC Network, FS1, NBC
- Finished game: Kent State Golden Flashes at Eastern Michigan Eagles (401866470, 2026-11-25T00:00Z) — summary 523 KB, 143 ms
- Summary keys: boxscore, format, gameInfo, drives, leaders, broadcasts, pickcenter, odds, againstTheSpread, scoringPlays, news, winprobability, article, videos, header, wallclockAvailable, meta, standings
- Win probability points: 172; plays: 173; scoring plays: 5; key events: 0; commentary: 0 (0 shots/goals)
- Team stats: firstDowns, thirdDownEff, fourthDownEff, totalYards, netPassingYards, completionAttempts, yardsPerPass, rushingYards, rushingAttempts, yardsPerRushAttempt, totalPenaltiesYards, turnovers, fumblesLost, interceptions, possessionTime
- Box score players: yes; predictor: no; odds (pickcenter): 1; series: no; shot map flag: null
- Standings: 200, 12 groups / 138 rows (American Conference, Atlantic Coast Conference, Big 12 Conference, Big Ten Conference, Conference USA, FBS Independents, Mid-American Conference, Mountain West Conference, Pac-12 Conference, Southeastern Conference, Sun Belt - East, Sun Belt - West)
- Standings stats: gamesBehind, leagueWinPercent, playoffSeed, pointDifferential, pointsAgainst, pointsFor, streak, wins, divisionLosses, divisionTies, divisionWins, lockedDivRank, overall, gamesBehind, leagueWinPercent, playoffSeed, pointDifferential, pointsAgainst, pointsFor, streak, wins, divisionLosses, divisionTies, divisionWins, lockedDivRank, Home, gamesBehind, leagueWinPercent, playoffSeed, pointDifferential
- Rankings: 200 — Playoff Committee Rankings (25); AP Top 25 (25); AFCA Coaches Poll (25); FCS Coaches Poll (25)

### NBA (`basketball/nba`)

- Scoreboard now: 11 events {"pre":11}, 177 KB, 416 ms
- Networks seen: Prime Video, MyMi, Bucks App, DAZN (YES), DAZN MIN, DAZN MEM, Suns Live, Arizona's Family 3TV, KFAA-TV, MavsTV, KJZZ-TV, Jazz+, ClipperVision, GCSEN, Pelicans.com, KUNP 16, BlazerVision
- Finished game: Sacramento Kings at Golden State Warriors (401909324, 2026-11-26T03:00Z) — summary 408 KB, 148 ms
- Summary keys: boxscore, format, gameInfo, leaders, seasonseries, injuries, broadcasts, pickcenter, odds, againstTheSpread, news, plays, header, winprobability, article, videos, wallclockAvailable, meta, standings
- Win probability points: 479; plays: 479; scoring plays: 0; key events: 0; commentary: 0 (0 shots/goals)
- Team stats: fieldGoalsMade-fieldGoalsAttempted, fieldGoalPct, threePointFieldGoalsMade-threePointFieldGoalsAttempted, threePointFieldGoalPct, freeThrowsMade-freeThrowsAttempted, freeThrowPct, totalRebounds, offensiveRebounds, defensiveRebounds, assists, steals, blocks, turnovers, teamTurnovers, totalTurnovers, technicalFouls, totalTechnicalFouls, flagrantFouls, turnoverPoints, fastBreakPoints, pointsInPaint, fouls, largestLead, leadChanges, leadPercentage
- Box score players: yes; predictor: no; odds (pickcenter): 1; series: yes; shot map flag: null
- Standings: 200, 2 groups / 30 rows (Eastern Conference, Western Conference)
- Standings stats: avgPointsAgainst, avgPointsFor, differential, divisionWinPercent, gamesBehind, leagueWinPercent, losses, playoffSeed, pointDifferential, points, pointsAgainst, pointsFor, streak, winPercent, wins, gamesAhead, overall, Home, Road, vs. Div., vs. Conf., Last Ten Games

### WNBA (`basketball/wnba`)

- Scoreboard now: 1 events {"post":1}, 28 KB, 385 ms
- Networks seen: USA Net, CNBC
- Finished game: Atlanta Dream at Golden State Valkyries (401918311, 2026-11-01T00:00Z) — summary 479 KB, 104 ms
- Summary keys: boxscore, format, gameInfo, leaders, seasonseries, injuries, broadcasts, pickcenter, odds, againstTheSpread, article, videos, news, plays, winprobability, header, wallclockAvailable, meta, standings
- Win probability points: 374; plays: 374; scoring plays: 0; key events: 0; commentary: 0 (0 shots/goals)
- Team stats: fieldGoalsMade-fieldGoalsAttempted, fieldGoalPct, threePointFieldGoalsMade-threePointFieldGoalsAttempted, threePointFieldGoalPct, freeThrowsMade-freeThrowsAttempted, freeThrowPct, totalRebounds, offensiveRebounds, defensiveRebounds, assists, steals, blocks, turnovers, teamTurnovers, totalTurnovers, technicalFouls, totalTechnicalFouls, flagrantFouls, turnoverPoints, fastBreakPoints, pointsInPaint, fouls, largestLead, leadChanges, leadPercentage
- Box score players: yes; predictor: no; odds (pickcenter): 1; series: yes; shot map flag: null
- Standings: 200, 2 groups / 15 rows (Eastern Conference, Western Conference)
- Standings stats: avgPointsAgainst, avgPointsFor, clincher, differential, divisionWinPercent, gamesBehind, leagueWinPercent, losses, playoffSeed, pointDifferential, points, pointsAgainst, pointsFor, streak, winPercent, wins, gamesAhead, overall, Home, Road, vs. Div., vs. Conf., Last Ten Games

### Men's College Basketball (`basketball/mens-college-basketball`)

- Scoreboard now: 11 events {"pre":11}, 209 KB, 61 ms
- Networks seen: FS1, ESPN, ESPN2, CBS, CBSSN, ESPNU
- Finished game: Duke Blue Devils at UConn Huskies (401909568, 2026-11-26T00:00Z) — summary 368 KB, 172 ms
- Summary keys: boxscore, format, gameInfo, leaders, broadcasts, pickcenter, odds, againstTheSpread, news, header, plays, winprobability, article, videos, wallclockAvailable, meta, standings
- Win probability points: 404; plays: 405; scoring plays: 0; key events: 0; commentary: 0 (0 shots/goals)
- Team stats: fieldGoalsMade-fieldGoalsAttempted, fieldGoalPct, threePointFieldGoalsMade-threePointFieldGoalsAttempted, threePointFieldGoalPct, freeThrowsMade-freeThrowsAttempted, freeThrowPct, totalRebounds, offensiveRebounds, defensiveRebounds, assists, steals, blocks, turnovers, teamTurnovers, totalTurnovers, technicalFouls, totalTechnicalFouls, flagrantFouls, turnoverPoints, fastBreakPoints, pointsInPaint, fouls, largestLead, leadChanges, leadPercentage
- Box score players: yes; predictor: no; odds (pickcenter): 1; series: no; shot map flag: null
- Standings: 200, 32 groups / 365 rows (America East Conference, American Conference, Atlantic 10 Conference, Atlantic Coast Conference, Atlantic Sun Conference, Big 12 Conference, Big East Conference, Big Sky Conference, Big South Conference, Big Ten Conference, Big West Conference, Coastal Athletic Association)
- Standings stats: avgPointsAgainst, avgPointsFor, gamesBehind, leagueWinPercent, losses, playoffSeed, pointDifferential, pointsAgainst, pointsFor, streak, winPercent, wins, gamesAhead, overall, avgPointsAgainst, avgPointsFor, gamesBehind, leagueWinPercent, losses, playoffSeed, pointDifferential, pointsAgainst, pointsFor, streak, winPercent, wins, gamesAhead, Home, avgPointsAgainst, avgPointsFor
- Rankings: 200 — AP Top 25 (25); Coaches Poll (25)

### Women's College Basketball (`basketball/womens-college-basketball`)

- Scoreboard now: 2 events {"in":1,"pre":1}, 30 KB, 81 ms
- Networks seen: ESPN2, FloSports
- Finished game: SE Louisiana Lady Lions at Texas Longhorns (401918845, 2026-11-26T00:00Z) — summary 463 KB, 102 ms
- Summary keys: boxscore, format, gameInfo, leaders, broadcasts, pickcenter, odds, againstTheSpread, news, winprobability, plays, article, videos, header, wallclockAvailable, meta, standings
- Win probability points: 439; plays: 443; scoring plays: 0; key events: 0; commentary: 0 (0 shots/goals)
- Team stats: fieldGoalsMade-fieldGoalsAttempted, fieldGoalPct, threePointFieldGoalsMade-threePointFieldGoalsAttempted, threePointFieldGoalPct, freeThrowsMade-freeThrowsAttempted, freeThrowPct, totalRebounds, offensiveRebounds, defensiveRebounds, assists, steals, blocks, turnovers, teamTurnovers, totalTurnovers, technicalFouls, totalTechnicalFouls, turnoverPoints, fastBreakPoints, pointsInPaint, fouls, largestLead, leadChanges, leadPercentage
- Box score players: yes; predictor: no; odds (pickcenter): 1; series: no; shot map flag: null
- Live game probed: West Virginia Mountaineers at Notre Dame Fighting Irish — win prob. points 250, plays 252, commentary 0
- Standings: 200, 32 groups / 363 rows (America East Conference, American Conference, Atlantic 10 Conference, Atlantic Coast Conference, Atlantic Sun Conference, Big 12 Conference, Big East Conference, Big Sky Conference, Big South Conference, Big Ten Conference, Big West Conference, Coastal Athletic Association)
- Standings stats: avgPointsAgainst, avgPointsFor, gamesBehind, leagueWinPercent, losses, playoffSeed, pointDifferential, pointsAgainst, pointsFor, streak, winPercent, wins, gamesAhead, overall, avgPointsAgainst, avgPointsFor, gamesBehind, leagueWinPercent, losses, playoffSeed, pointDifferential, pointsAgainst, pointsFor, streak, winPercent, wins, gamesAhead, Home, avgPointsAgainst, avgPointsFor
- Rankings: 200 — AP Top 25 (25); Coaches Poll (25)

### MLB (`baseball/mlb`)

- Scoreboard now: 1 events {"post":1}, 20 KB, 119 ms
- Networks seen: Fox, ERADM
- Finished game: Milwaukee Brewers at Tampa Bay Rays (401908045, 2026-10-28T00:00Z) — summary 1150 KB, 141 ms
- Summary keys: notes, boxscore, format, gameInfo, seasonseries, injuries, broadcasts, pickcenter, odds, againstTheSpread, news, rosters, header, article, videos, winprobability, plays, playsMap, atBats, wallclockAvailable, meta, standings
- Win probability points: 92; plays: 719; scoring plays: 0; key events: 0; commentary: 0 (0 shots/goals)
- Team stats: batting, pitching, fielding, records
- Box score players: yes; predictor: no; odds (pickcenter): 1; series: yes; shot map flag: null
- Standings: 200, 2 groups / 30 rows (American League, National League)
- Standings stats: OTLosses, OTWins, avgPointsAgainst, avgPointsFor, clincher, differential, divisionWinPercent, gamesBehind, gamesPlayed, leagueWinPercent, losses, playoffSeed, pointDifferential, points, pointsAgainst, pointsFor, streak, ties, winPercent, wins, divisionGamesBehind, divisionPercent, divisionTied, homeLosses, homeTies, homeWins, magicNumberDivision, magicNumberWildcard, playoffPercent, roadLosses

### NHL (`hockey/nhl`)

- Scoreboard now: 15 events {"pre":15}, 301 KB, 71 ms
- Networks seen: ESPN+, NESN, MSGSN, Scripps Sports, Utah 16, Mammoth+, NHL Net, Blues App, BN+, Prime Video (Local), The Spot - MTN, NBC Sports Phil, MNMT, DSN, CBJNHL, Altitude Sports, MINNHL, KCOP, Fox 11 Plus, ABTV, NBC Sports BA, TNT, truTV, KONG
- Finished game: San Jose Sharks at Anaheim Ducks (401892793, 2026-11-26T03:00Z) — summary 478 KB, 117 ms
- Summary keys: boxscore, format, gameInfo, leaders, seasonseries, injuries, broadcasts, pickcenter, odds, againstTheSpread, news, plays, article, videos, header, wallclockAvailable, onIce, meta, standings
- Win probability points: 0; plays: 314; scoring plays: 0; key events: 0; commentary: 0 (0 shots/goals)
- Team stats: blockedShots, hits, takeaways, shotsTotal, powerPlayGoals, powerPlayOpportunities, powerPlayPct, shortHandedGoals, shootoutGoals, faceoffsWon, faceoffPercent, giveaways, penalties, penaltyMinutes
- Box score players: yes; predictor: no; odds (pickcenter): 1; series: yes; shot map flag: null
- Standings: 200, 2 groups / 32 rows (Eastern Conference, Western Conference)
- Standings stats: otLosses, differential, gamesBehind, gamesPlayed, losses, playoffSeed, pointDifferential, points, pointsAgainst, pointsFor, streak, wins, overtimeLosses, overtimeWins, pointsDiff, regLosses, regWins, rotLosses, rotWins, shootoutLosses, shootoutWins, overall, Home, Road, Last Ten Games, vs. Div.

### Premier League (`soccer/eng.1`)

- Scoreboard now: 1 events {"pre":1}, 15 KB, 59 ms
- Networks seen: USA Net, Universo
- Finished game: Everton at Brentford (401879237, 2026-11-23T20:00Z) — summary 396 KB, 135 ms
- Summary keys: boxscore, format, gameInfo, lastFiveGames, leaders, broadcasts, pickcenter, odds, hasOdds, rosters, news, article, videos, header, seasonseries, keyEvents, commentary, wallclockAvailable, meta, standings
- Win probability points: 0; plays: 0; scoring plays: 0; key events: 36; commentary: 98 (25 shots/goals)
- Team stats: foulsCommitted, yellowCards, redCards, offsides, wonCorners, saves, possessionPct, totalShots, shotsOnTarget, shotPct, penaltyKickGoals, penaltyKickShots, accuratePasses, totalPasses, passPct, accurateCrosses, totalCrosses, crossPct, totalLongBalls, accurateLongBalls, longballPct, blockedShots, effectiveTackles, totalTackles, tacklePct, interceptions, effectiveClearance, totalClearance
- Box score players: no; predictor: no; odds (pickcenter): 1; series: no; shot map flag: true
- xG fields: .leaders[0].leaders[0].leaders[0].statistics[2].name=expectedGoals, .leaders[0].leaders[3].leaders[0].statistics[2].name=expectedGoalsConceded, .leaders[1].leaders[0].leaders[0].statistics[2].name=expectedGoals, .leaders[1].leaders[3].leaders[0].statistics[2].name=expectedGoalsConceded
- Core API team stats: 200 ✓CORS, 172 stats, xG yes, big chances yes
- Standings: 200, 1 groups / 20 rows (2026-27 English Premier League)
- Standings stats: gamesPlayed, losses, pointDifferential, points, pointsAgainst, pointsFor, ties, wins, advanced, deductions, ppg, rank, rankChange, overall

### Champions League (`soccer/uefa.champions`)

- Scoreboard now: 9 events {"post":9}, 92 KB, 101 ms
- Networks seen: Paramount+
- Finished game: Viking FK at Atlético Madrid (401915291, 2026-11-25T20:00Z) — summary 410 KB, 110 ms
- Summary keys: boxscore, format, gameInfo, lastFiveGames, leaders, broadcasts, pickcenter, odds, hasOdds, news, rosters, videos, header, keyEvents, commentary, wallclockAvailable, meta, standings
- Win probability points: 0; plays: 0; scoring plays: 0; key events: 20; commentary: 91 (29 shots/goals)
- Team stats: foulsCommitted, yellowCards, redCards, offsides, wonCorners, saves, possessionPct, totalShots, shotsOnTarget, shotPct, penaltyKickGoals, penaltyKickShots, accuratePasses, totalPasses, passPct, accurateCrosses, totalCrosses, crossPct, totalLongBalls, accurateLongBalls, longballPct, blockedShots, effectiveTackles, totalTackles, tacklePct, interceptions, effectiveClearance, totalClearance
- Box score players: no; predictor: no; odds (pickcenter): 1; series: no; shot map flag: true
- xG fields: .leaders[0].leaders[0].leaders[0].statistics[2].name=expectedGoals, .leaders[0].leaders[3].leaders[0].statistics[2].name=expectedGoalsConceded, .leaders[1].leaders[0].leaders[0].statistics[2].name=expectedGoals, .leaders[1].leaders[3].leaders[0].statistics[2].name=expectedGoalsConceded
- Core API team stats: 200 ✓CORS, 172 stats, xG yes, big chances yes
- Standings: 200, 1 groups / 36 rows (League Phase)
- Standings stats: gamesPlayed, losses, pointDifferential, points, pointsAgainst, pointsFor, ties, wins, advanced, deductions, ppg, rank, rankChange, overall

### Europa League (`soccer/uefa.europa`)

- Scoreboard now: 18 events {"pre":18}, 225 KB, 77 ms
- Networks seen: Paramount+
- Finished game: Juventus at AZ Alkmaar (401915529, 2026-11-05T20:00Z) — summary 431 KB, 99 ms
- Summary keys: boxscore, format, gameInfo, lastFiveGames, leaders, broadcasts, pickcenter, odds, hasOdds, rosters, news, header, videos, keyEvents, commentary, wallclockAvailable, meta, standings
- Win probability points: 0; plays: 0; scoring plays: 0; key events: 31; commentary: 125 (27 shots/goals)
- Team stats: foulsCommitted, yellowCards, redCards, offsides, wonCorners, saves, possessionPct, totalShots, shotsOnTarget, shotPct, penaltyKickGoals, penaltyKickShots, accuratePasses, totalPasses, passPct, accurateCrosses, totalCrosses, crossPct, totalLongBalls, accurateLongBalls, longballPct, blockedShots, effectiveTackles, totalTackles, tacklePct, interceptions, effectiveClearance, totalClearance
- Box score players: no; predictor: no; odds (pickcenter): 1; series: no; shot map flag: true
- xG fields: .leaders[0].leaders[0].leaders[0].statistics[2].name=expectedGoals, .leaders[1].leaders[0].leaders[0].statistics[2].name=expectedGoals, .leaders[1].leaders[3].leaders[0].statistics[2].name=expectedGoalsConceded
- Core API team stats: 200 ✓CORS, 171 stats, xG yes, big chances yes
- Standings: 200, 1 groups / 36 rows (League Phase)
- Standings stats: gamesPlayed, losses, pointDifferential, points, pointsAgainst, pointsFor, ties, wins, advanced, deductions, ppg, rank, rankChange, overall

### MLS (`soccer/usa.1`)

- Scoreboard now: 2 events {"pre":2}, 28 KB, 58 ms
- Networks seen: FS1, Apple TV
- Finished game: Houston Dynamo FC at San Jose Earthquakes (401933738, 2026-11-25T03:00Z) — summary 371 KB, 139 ms
- Summary keys: boxscore, format, gameInfo, lastFiveGames, leaders, broadcasts, pickcenter, odds, hasOdds, rosters, news, article, videos, header, seasonseries, keyEvents, commentary, wallclockAvailable, meta, standings
- Win probability points: 0; plays: 0; scoring plays: 0; key events: 24; commentary: 109 (20 shots/goals)
- Team stats: foulsCommitted, yellowCards, redCards, offsides, wonCorners, saves, possessionPct, totalShots, shotsOnTarget, shotPct, penaltyKickGoals, penaltyKickShots, accuratePasses, totalPasses, passPct, accurateCrosses, totalCrosses, crossPct, totalLongBalls, accurateLongBalls, longballPct, blockedShots, effectiveTackles, totalTackles, tacklePct, interceptions, effectiveClearance, totalClearance
- Box score players: no; predictor: no; odds (pickcenter): 1; series: yes; shot map flag: true
- xG fields: .leaders[0].leaders[0].leaders[0].statistics[2].name=expectedGoals, .leaders[0].leaders[3].leaders[0].statistics[2].name=expectedGoalsConceded, .leaders[1].leaders[0].leaders[0].statistics[2].name=expectedGoals, .leaders[1].leaders[3].leaders[0].statistics[2].name=expectedGoalsConceded
- Core API team stats: 200 ✓CORS, 172 stats, xG yes, big chances yes
- Standings: 200, 2 groups / 30 rows (Eastern Conference, Western Conference)
- Standings stats: gamesPlayed, losses, pointDifferential, points, pointsAgainst, pointsFor, ties, wins, advanced, deductions, ppg, rank, rankChange, overall

### NWSL (`soccer/usa.nwsl`)

- Scoreboard now: 1 events {"post":1}, 21 KB, 69 ms
- Networks seen: CBS, Paramount+
- Finished game: Kansas City Current at Washington Spirit (401934232, 2026-11-22T01:00Z) — summary 396 KB, 142 ms
- Summary keys: boxscore, format, gameInfo, lastFiveGames, leaders, broadcasts, pickcenter, odds, hasOdds, rosters, news, article, videos, header, seasonseries, keyEvents, commentary, wallclockAvailable, meta, standings
- Win probability points: 0; plays: 0; scoring plays: 0; key events: 30; commentary: 136 (33 shots/goals)
- Team stats: foulsCommitted, yellowCards, redCards, offsides, wonCorners, saves, possessionPct, totalShots, shotsOnTarget, shotPct, penaltyKickGoals, penaltyKickShots, accuratePasses, totalPasses, passPct, accurateCrosses, totalCrosses, crossPct, totalLongBalls, accurateLongBalls, longballPct, blockedShots, effectiveTackles, totalTackles, tacklePct, interceptions, effectiveClearance, totalClearance
- Box score players: no; predictor: no; odds (pickcenter): 1; series: no; shot map flag: true
- xG fields: .leaders[0].leaders[0].leaders[0].statistics[2].name=expectedGoals, .leaders[0].leaders[3].leaders[0].statistics[2].name=expectedGoalsConceded, .leaders[1].leaders[0].leaders[0].statistics[2].name=expectedGoals, .leaders[1].leaders[3].leaders[0].statistics[2].name=expectedGoalsConceded
- Core API team stats: 200 ✓CORS, 172 stats, xG yes, big chances yes
- Standings: 200, 1 groups / 16 rows (NWSL Regular Season)
- Standings stats: gamesPlayed, losses, pointDifferential, points, pointsAgainst, pointsFor, ties, wins, advanced, deductions, ppg, rank, rankChange, overall

### Women's Super League (`soccer/eng.w.1`)

- Scoreboard now: 5 events {"post":5}, 48 KB, 88 ms
- Networks seen: Paramount+
- Finished game: West Ham United at Arsenal (401902858, 2026-11-22T14:30Z) — summary 336 KB, 120 ms
- Summary keys: boxscore, format, gameInfo, lastFiveGames, leaders, broadcasts, pickcenter, odds, hasOdds, rosters, news, videos, header, seasonseries, keyEvents, commentary, wallclockAvailable, meta, standings
- Win probability points: 0; plays: 0; scoring plays: 0; key events: 28; commentary: 114 (33 shots/goals)
- Team stats: foulsCommitted, yellowCards, redCards, offsides, wonCorners, saves, possessionPct, totalShots, shotsOnTarget, shotPct, penaltyKickGoals, penaltyKickShots, accuratePasses, totalPasses, passPct, accurateCrosses, totalCrosses, crossPct, totalLongBalls, accurateLongBalls, longballPct, blockedShots, effectiveTackles, totalTackles, tacklePct, interceptions, effectiveClearance, totalClearance
- Box score players: no; predictor: no; odds (pickcenter): 1; series: no; shot map flag: true
- Core API team stats: 200 ✓CORS, 157 stats, xG no, big chances yes
- Standings: 200, 1 groups / 14 rows (2026-27 English Women's Super League)
- Standings stats: gamesPlayed, losses, pointDifferential, points, pointsAgainst, pointsFor, ties, wins, advanced, deductions, ppg, rank, rankChange, overall

### Formula 1 (`racing/f1`)

- Scoreboard now: 1 events {"pre":1}, 11 KB, 79 ms
- Networks seen: Apple TV
- Session types: FP1, FP2, FP3, Qual, Race
- Finished game: Heineken Las Vegas Grand Prix (600057449, 2026-11-20T00:30Z) — summary 0 KB, 87 ms
- Summary keys: code, message
- Win probability points: 0; plays: 0; scoring plays: 0; key events: 0; commentary: 0 (0 shots/goals)
- Box score players: no; predictor: no; odds (pickcenter): 0; series: no; shot map flag: null
- F1 sessions on scoreboard: FP1 (22 drivers, order); FP2 (22 drivers, order); FP3 (22 drivers, order); Qual (22 drivers, order); Race (22 drivers, order)
- Standings: 200, 2 groups / 36 rows (Driver Standings, Constructor Standings)
- Standings stats: rank, championshipPts, AUS, CHN, JPN, BRN, SAU, MIA, CAN, MCO, BAR, AUT, GBR, BEL, HUN, NLD, ITA, ESP, AZE, MYS, SGP, USA, MEX, BRA, LAS, QAT, UAE, overall

## F1 supplementary sources

- **openf1Sessions**: 200 ✓CORS   Las Vegas 2026-11-22T04:00:00+00:00  
- **openf1_race_control**: 200 ✓CORS  rows 110   
- **openf1_position**: 200 ✓CORS  rows 708   
- **openf1_overtakes**: 200 ✓CORS  rows 361   
- **openf1_intervals**: 200 ✓CORS  rows 21166   
- **openf1_laps**: 200 ✓CORS  rows 989   
- **openf1_session_result**: 200 ✓CORS  rows 22   
