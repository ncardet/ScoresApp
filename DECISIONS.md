# Decisions

Choices made while building Sideline that the spec left open, with the reason for each.
Newest at the bottom of each section.

## Platform and stack

- **Vanilla JS ES modules, no build step, no runtime dependencies.** The same modules (adapters, rating
  engine) run in the browser, in the GitHub Actions scripts and in the tests, with nothing to install.
  Tests use Node's built-in test runner.
- **Web root is `site/`.** Scripts, tests and docs stay out of the published site.
- **Hash routing** (`#/game/nba/401…`) so deep links work on GitHub Pages with no 404 tricks.
- **GitHub Pages via Actions** ("Source: GitHub Actions"), not "deploy from branch". The brief job
  deploys in the same run that commits the data, rather than relying on a push triggering a build.
  Every deploy stamps the service worker, so phones pick up new code on the next open.
- **Repo must be public** for free GitHub Pages (or use GitHub Pro).

## Data

- **ESPN is called directly from the browser.** Every ESPN endpoint returns
  `Access-Control-Allow-Origin: *` (see `docs/probe-report.md`), so no proxy or Worker is needed.
- **ESPN rejects date ranges** (`dates=A-B` returns 400), so the app fetches one day per league, and the
  backfill samples individual days. A bare year (`dates=2026`) does work and returns the whole calendar
  year: used for the March Madness bracket (`groups=100`) and UCL/UEL knockouts.
- **ESPN's CDN (Akamai) denies headless Chrome** (`sec-ch-ua: HeadlessChrome`). Real browsers, curl and
  Node are fine. Only matters for automated browser tests, which fetch ESPN through Node.
- **Soccer xG comes from ESPN's core API** (`sports.core.api.espn.com/…/competitors/{id}/statistics`):
  team xG plus 170 match stats (big chances, touches in the box, …). It's CORS-open; the summary
  endpoint only has the top shooter's xG. WSL has no xG, so the stat is hidden there.
- **F1 detail comes from OpenF1** (free, CORS-open): laps, overtakes, race-control flags, results.
  ESPN has no racing summary (404) but provides the schedule, session order and both standings.
  Jolpica (the Ergast successor) was considered; it refuses non-browser clients from CI, so it isn't used.
  OpenF1's free tier rate-limits bursts, so calls are paced. Live race data may need an OpenF1
  subscription; during a race the app shows the prediction until lap data is available.
- **College filter:** a game is shown if either team is in the **AP Top 25** (rankings endpoint, cached
  6 h; the current poll is used even for past dates) or is a favorite. ESPN's default basketball
  scoreboard only lists ranked games, so when USC is unranked its game is fetched from its conference
  scoreboard (`groups=<conference>`, looked up from the team).
- **March Madness** = the NCAA tournament only (First Four through the final), from ESPN's tournament
  group (100). NIT, CBI and conference tournaments are excluded. Window: March 14–April 10.
- **Dates:** ESPN's `dates=` parameter is treated as the Pacific day. Late-night West Coast or Hawaii
  starts can land on ESPN's next day; F1 fetches the next day too, because sessions cross midnight.
- **Offline:** every successful ESPN response is kept in IndexedDB; on failure the last copy is shown
  with "Couldn't reach ESPN; showing data from 10:42am". Each day's list is snapshotted, so the app
  opens instantly. The service worker caches the app shell and team logos.

## Ratings

- **Per-play win probability from ESPN** for NFL, college football, NBA, both college basketball
  leagues and MLB. **Fallback models** elsewhere (and whenever ESPN has fewer than 10 points):
  - NHL: Poisson on remaining goals (3.1 per team per 60), tied after regulation = 52% home.
  - Soccer: Poisson with the pre-game odds split into home/away scoring rates. Win probability is
    "result share" = P(win) + ½·P(draw), so draws count as halfway.
  - Basketball/football fallback: Brownian motion on the margin (σ per league).
  - Baseball fallback: normal approximation on remaining runs (σ ≈ 4.4).
- **GEI swing is resampled every 0.5% of regulation and late-weighted.** ESPN's NBA win probability
  jitters on every free throw and rebound, so the plain per-play sum is ~9 even in ordinary games and
  hides late drama. Both settings live in `config/rating.js`: `swingResample: 0` and
  `swingLateBoost: 0` give the textbook GEI.
- **Weights** (swing .26, comeback .18, closeness .16, novelty .16, lead changes .10, stakes .10,
  pace .04) were chosen so the saved classics rate Great and blowouts Dull without per-league
  tuning. Swing is still the largest single weight. Calibration files store raw component values,
  so changing weights never needs a new backfill.
- **Calibration:** the rating is the percentile among ~200 sampled games from the last 365 days
  (730 for UCL, UEL, WSL and NWSL; 69 races for F1), mapped so the median is 50 and the 87.5th
  percentile is 85. About 12.5% of games are Great.
- **Predicted ratings** anchor the league's median prior at 50 and the 90th percentile at +35 points,
  shrunk by 0.85 with a soft cap at 97. A Game 7 still ranks above a marquee regular-season game.
- **Live blending:** live = (1 − a)·predicted + a·in-game, with a = progress^1.2. Early in a game the
  in-game evidence is thin; by the final whistle a = 1 and the rating freezes.
- **"Involvement of a favorite" is not part of the rating number.** The spec lists it under the context
  prior but also says "do not inflate their rating number", so favorites only get pinned to the top
  and a +8 ranking boost (when pinning is turned off in Settings).
- **Stakes** feed both the prediction and a small in-game component: playoffs, elimination games, a
  Game 7 / final / second leg, configured rivalries, and ranked-vs-ranked college games. ESPN's series
  record on a finished game already includes that game, so it is backed out to get the true stakes.
- **F1:** only the race is rated (lead changes, overtakes, P1–P2 gap over the final 20% of laps,
  safety cars/VSC/red flags, championship stakes from per-race standings points).
- **Final ratings are frozen** and cached per game in IndexedDB, keyed by engine version, so each
  finished game is fetched once.

## Where to watch

- Only broadcasters that map to your services are shown. If ESPN lists broadcasters but none map,
  the row says "Not on your services". If ESPN lists none at all, the row says nothing, rather than
  wrongly claiming it isn't on.
- NFL Sunday games on CBS/FOX are regional: ESPN doesn't say which region gets which game, so a
  CBS game shows "CBS · YouTube TV" even if your local CBS is showing a different one.
- LA regional networks (Spectrum SportsNet, SportsNet LA, FanDuel Sports Network) and ESPN+, Apple TV
  (MLS, and F1 from 2026) aren't in the map because your services don't carry them.

## Settings

- Settings edits are stored on the phone (localStorage). The config files stay the source of truth
  for the morning brief, which runs in GitHub Actions. "Copy favorites as config" exports a
  `config/favorites.js` snippet so the two can be kept in sync.

## Brief

- Scheduled at 12:50 and 13:50 UTC. The script runs only between 4 and 9 am Los Angeles time and only
  if today's brief is missing, which handles daylight saving and a delayed or failed first run.
  The daily commit also counts as repository activity, so GitHub never auto-disables the schedule
  after 60 quiet days.
- "Today's top games" excludes games that have already finished by brief time. Live games are ranked
  by their live rating.
