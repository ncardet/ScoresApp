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
- **Weights** (engine v4): swing .29, stakes .19, comeback .17, closeness .16, novelty .16, lead
  changes .10, quality .06, pace .04, plus a **stakes amplifier**: the weighted score is multiplied
  by (1 + 0.37 × stakes), where stakes is already scaled by how competitive the game was. Tuned
  against the labeled fixtures (see "Post-game rating changes" below). Calibration files store raw
  component values, so changing weights or amplifiers never needs a new backfill; changing
  `swingLateBoost` or `comebackLateness` does (they shape the raw swing and comeback values).
- **Calibration:** the rating is the percentile among up to 1,500 backfilled games per league from the
  backtest seasons (2–3 seasons; all 91 races 2023–2026 for F1), mapped so the median is 50 and the
  87.5th percentile is 85. About 12.5% of games are Great. `scripts/backtest.mjs` rewrites
  `site/data/calibration/*.json`; the rating tuner uses the identical deterministic sample.
- **Predicted ratings** come from the pre-game model (see "Pre-game predictions" below). The old
  "every game starts at 50" prior is gone.
- **Live blending:** live = w·predicted + (1 − w)·in-game, w = (1 − progress)², as the addendum
  specifies. At kickoff the badge is the prediction; at halftime the prediction carries 25%; at the
  final whistle none.
- **"Involvement of a favorite" is not part of the rating number.** Favorites only change Watch
  Priority (+5), which orders lists. With pinning turned on in Settings they are also pinned to the top.
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
- **Brief v2 (schema 2):** the window is games starting 7 am today to 3 am tomorrow PT (ESPN's
  scoreboard days don't line up with Pacific nights, so today's and tomorrow's scoreboards are both
  loaded and filtered by start time). Favorites today runs from midnight, so an early kickoff is still
  listed. Top 5 by Watch Priority with at most 2 per league; a live game that is already Dull isn't a
  pick. **Skip** is chosen first and never also appears as a pick: the most high-profile game
  (favorite, star power, national TV, AP top 10) whose prediction is under 40 or whose P(Dull) is at
  least 35% (predictions rarely go below 40 after shrinkage, so P(Dull) does most of the work).
  **Sleeper** is the highest P(Great) outside the top 5, with no minimum. **Coming up** lists flags
  that are new since the previous brief (the previous brief.json is the memory), up to 6.

## Pre-game predictions (addendum)

- **Two numbers.** The badge shows *Predicted Excitement* (objective, no personal boosts). *Watch
  Priority* = prediction + 5 for a favorite + 0–4 star power from `config/teams.json` (a hand-kept
  list of star teams; Super Bowl, World Series, Finals and title games count as 3). Priority only
  orders the Today list, Look Ahead and the brief, and is never shown as a rating.
- **Where the work happens.** A nightly Action (`predictions.yml`, ~2 am PT, DST-proof like the brief)
  updates Elo, simulates each season 10,000 times and writes `data/predictions.json` (14 days, plus
  "Circle this one" flags up to 60 days out). The app and the brief re-run each game 0–2 days out
  against the scoreboard's current odds, so a newly posted line replaces the Elo estimate.
- **Elo** (`config/prediction.json` → `elo`): FiveThirtyEight-style with a margin-of-victory multiplier
  per sport family. Carryover between seasons: NFL 0.667 (a third regressed, as specified), NBA 0.75,
  MLB 0.67, NHL 0.7, CFB and college basketball 0.6 (rosters turn over fastest), soccer 0.8, UCL/UEL
  0.85. New teams start low (CFB 1250, college basketball 1350, promoted EPL/WSL sides 1400). UCL and
  UEL share one "uefa" rating pool, so a club's rating follows it between the two. Spread conversion:
  25 Elo per point (NFL/CFB), 28 (NBA), 30 (college basketball).
- **Soccer draws:** P(draw) = 0.28 · exp(−(ΔElo / 330)²), with home win + draw/2 kept equal to Elo's
  expected score. Simple, and the backtest's calibration of draws was reasonable; a Poisson model was
  not needed.
- **Importance** = for each team, Σ weight × |P(outcome | win) − P(outcome | loss)| over its season
  outcomes (playoffs, seeds, title, top four, relegation, …; `predict/simulate.js` FORMATS). Both
  teams near zero = dead rubber. College has no format (too many teams, committee selection): its
  stakes come from AP ranks, rivalry week and tournament context instead.
- **Formula:** Raw = Base + terms; **blowout guard** caps stakes + narrative at +4 when closeness is
  −7 or worse; Predicted = Base + k·(Raw − Base), clipped 5–98. After the backtest, k is the slope
  the data supports per league (clipped to 0.2–1): e.g. NFL 0.59, NBA 0.86, NHL 0.36, EPL 0.22. The
  config's term tables stay as written; k shrinks them where pre-game signals are weak.
- **Base rates are centered, not raw medians.** The addendum says to use each league's median rating
  (with a separate playoff median) *and* keeps the postseason terms. But a playoff median already
  contains what playoff stakes do, so adding "+8 College Football Playoff" and "+8 both top 10" on
  top predicted the 2023 CFP final (Georgia 65–7 TCU, a labeled Dull game) at 90. Each base is now
  the segment's median minus k × the average term contribution in that segment, so the average
  prediction still lands on the median and only above-typical stakes move a game (CFB playoffs:
  median 74, base 56; NFL playoffs: median 65, base 54). The report shows both numbers.
- **Fitted ridge vs rules:** the ridge regression on the same features is used only where it clearly
  beats the rules out of sample (+0.02 within-day ρ without losing top-decile precision, or as good
  a ranking with +5 points of top-decile precision). That is women's college basketball; everywhere
  else the explainable rules are kept. With a fitted model the sheet scales each term so
  the contributions add up to the model's output.
- **Ranges and probabilities:** the likely range is the 25th–75th percentile of backtest residuals
  per league *and horizon tier*, measured rather than multiplied (×1.2, ×1.5): the far-out inputs
  are the same Elo and simulations used close in, so the measured spread barely grows; only the
  closing line adds information at 0–2 days. Ranges are wide (half-widths of 20–27 points) because
  ratings are percentiles and pre-game information explains little, as the addendum expected.
  P(Great) and P(Dull) are per-league, per-tier logistic fits on the predicted value; the normal
  approximation remains only as a fallback.
- **Horizons:** 0–2 days Prediction, 3–7 Forecast, 8–14 Early look (number rounded to 5), 15+ days
  no number, only "Circle this one". Flags (two or more of the five rules) are re-checked **nightly**
  rather than weekly, so a collapse or key injury removes a flag the next morning. F1 races are only
  predicted 14 days out, so they are never circled further ahead.
- **Availability and starters:** NFL starting QB and NBA/college season scoring leader out or doubtful
  (summary injuries, nightly for the next 2 days), at half weight once a line exists. MLB "aces" when
  both probable starters have an ERA ≤ 3.25 with at least 5 decisions; "bullpen game" when one side
  lists no starter within 30 hours. NHL "backup goalie" when the probable goalie isn't the one who
  made at least 60% of the team's starts in the last three weeks (a tandem never counts as a backup).
  Soccer lineups (posted ~1 hour before kickoff) are **not** used: nothing in the app runs that close
  to kickoff except the live view, where the in-game rating takes over anyway.
- **Weather:** F1 rain from Open-Meteo (more than 7 days out counts half). NFL wind (gusts ≥ 20 mph)
  and snow, and MLB rain (delay/rainout risk, −1), come from ESPN's own AccuWeather block (scoreboard
  condition text; summary gusts, fetched nightly for the week's NFL games), so no stadium
  coordinates are needed. Indoor venues are skipped.
- **Same-day clinches and eliminations** are picked up by the next nightly simulation, not intraday.

## Backfill and backtest (addendum)

- **Targets** are our own post-game ratings, from summaries cached in `.cache/targets` (resumable,
  throttled). Seasons (ESPN season years): NFL 2024–25, CFB 2023–25, NBA 2025–26, NHL 2025–26, MLB
  2025–26, college basketball 2024–26, EPL/WSL/UCL/UEL 2023–25, MLS and NWSL 2024–26, F1 2023–26
  (91 races; OpenF1 has no lap data before 2023). Elo walks start one to three seasons earlier.
- **Point in time:** Elo, standings, importance (weekly simulation checkpoints, 1,500 runs, seeded so
  reruns are identical), Elo percentiles and scoring style are rebuilt as of each game's date for each
  horizon (0, 5 and 11 days before). Walk-forward: each test season is predicted by a model trained
  only on earlier seasons. `pregameView()` is the only game the predictor sees; a test fails if a
  post-kickoff field changes a prediction.
- **Lines:** historical closing lines come from the summary's `pickcenter` and are used only in the
  0–2 day tier. Coverage varies a lot (CFB 7%, NFL 37%, NBA 81%, MLB 100%), so the report adds a
  "closing line" subset row. nflverse, collegefootballdata.com and FiveThirtyEight's archives were not
  added: they are optional in the addendum and would add data sources for backtesting only.
- **Results** (`reports/backtest.md`): within-day rank correlation 0–2 days out is 0.56 in women's and
  0.44 in men's college basketball and 0.43 in CFB (big mismatches are common and predictable), 0.27
  in the NBA, 0.19 in the NFL, 0.16–0.24 in UCL/WSL/NWSL, and close to zero in MLB, the NHL, the EPL,
  UEL and MLS. Against spread-only, **only UCL and WSL clearly win**; most leagues roughly tie and
  CFB, the NFL and MLB fall a little short (the NFL's top-decile gap is within sampling noise). In
  other words, beyond the point spread our other features add little ranking signal. The F1
  pre-race model is uninformative (AUC 0.51 on 91 races) and stays on the circuit/rain/grid rules.
  These are honest numbers, not a success: the addendum's targets (soccer r ≈ 0.3–0.4) were not
  reached.
- **Config updates from the backtest:** centered base rates per league (regular season 40–49,
  playoffs 48–71; the medians themselves are 48–51 and 54–75), k per league, ranges and logistic
  coefficients per tier, fitted coefficients where used.
  `node scripts/backtest.mjs` regenerates all of it; `--no-write` only reports.
- **Scoring style** (both teams' total points/goals/runs per game as a z-score) was generalized
  from the NBA to every team sport; it didn't move soccer, NHL or MLB much and is kept as a small term.

## Post-game rating changes (addendum)

- **Labeled fixtures:** 57 rows in `test/fixtures/labeled_games.csv`; 56 saved as trimmed summaries
  (`test/fixtures/labeled/`). The 2021 Belgian GP (two laps behind the safety car) was dropped:
  OpenF1 has no lap data before 2023 (`_dropped.json`).
- **Tuning:** `scripts/tune-rating.mjs --search` runs a seeded random search plus local refinement
  over the weights, the stakes amplifier, comeback lateness, late swing boost and soccer closeness
  trust, scoring the labeled hit rate, the 11 classic fixtures, "no Great below 75" and the margin
  inside each band, with a small pull toward the previous settings. It evaluates the rounded values
  exactly as written to `config/rating.js`, against the same calibration rows the app loads.
- **Main change:** stakes became mostly a *multiplier* (×(1 + 0.37 × stakes)) instead of only an
  additive weight. As an additive term, a heavy stakes weight capped every regular-season classic
  below playoff games; as a multiplier it lifts a tense Game 7 or final without rescuing a dull one.
- **Result: 50 of 56 fixtures in band (89%), one short of the 90% target.** No Great fixture rates
  below 75 and no Dull fixture is predicted Great. The 90% assertion stays in the test suite as a
  visible TODO (so a known one-fixture shortfall doesn't block deploys) next to a hard guard that it
  never drops below 50/56. A longer search, a late-swing credit and judging competitiveness on the
  late game only were all tried; none found a 46th team-sport fixture without breaking others.
- **Remaining team-sport misses (5/50):** the 2022 Pac-12 title game (labeled Dull; USC led 17–3 and
  it was 24–27 early in the 4th, so it measures as competitive), the 2023 men's NCAA final (labeled
  Dull, rates 51: SDSU got within five late), two regular-season NFL classics (Bengals–Ravens 2024 at
  83 and Bills–Ravens 2025 at 77: one-way comebacks score modest total swing and little late
  closeness), and the 2025 UEL final (labeled Dull, rates 70: a 1–0 final reads as tense). A
  "late swing" credit was tried for the comeback games and left off (it didn't help and pushed an
  ugly Giants–Jets overtime game into Great).

## Data quirks found while backtesting

- **ESPN sometimes reverses home/away in play-by-play scores** for neutral-site games (2026 Toledo vs
  Michigan, Baha Mar: Michigan's 102–56 win read as a 50-point comeback). The summary parser now checks
  which team scored each basket/goal/run against the official final, swaps the play scores back, and
  drops ESPN's win probability for that game (it was computed on the reversed scores). No game in the
  backtest seasons needed it, but it now protects live games.
- **OpenF1's race control "CHEQUERED FLAG" contains the letters "RED FLAG"**, so every race counted a
  red flag at the finish. Fixed with a word match.
- **OpenF1's overtakes feed counts pit-cycle position changes** (188 "overtakes" at Monaco 2025). F1
  passes and lead changes are now counted on track: only between drivers who didn't pit on the lap
  before, during or after. Added a *charge* component (places a podium finisher made up after lap 1),
  so a drive like Interlagos 2024 (P17 to the win) registers.
- **F1 weights after the fixes:** on-track passes .30, safety cars/red flags .26, fight for the win
  .20, stakes .08, lead changes .06, charge .05, chosen on the 6 labeled races with every component
  kept meaningful (an unconstrained search zeroed lead changes and charge, which would be fitting six
  races). Result 5/6: Interlagos 2024 89, Australia 2025 86, both Monaco races Dull, Abu Dhabi 2025
  41 (OK). Canada 2024 (labeled Great) rates 80: its drama was a multi-car strategy fight in changing
  conditions, and the rating only sees the P1–P2 gap, not the cars behind. The backfill and the F1
  fixtures now keep the lap table and raw race-control messages, so the F1 maths can change without
  refetching OpenF1.

## Design

The look follows Ball.app: bold, outlined and sporty. The colours are the "Wasabi and Nori" palette.
The Wasabi and Nori spec also came with a plainer layout (commit `9a50436`: thin borders, small
tags, no team-colour posters, system font only). That layout was replaced, because the palette was
wanted, not the plainer style. In `docs/screenshots/theme/`, the `before-*` shots are the first Ball
version (cobalt and mint) and the `after-*` shots are this one. They cover Today, Look Ahead, a game
page, Standings and Settings, in light and dark; `npm run screenshots <label>` retakes them.

- **Look:** Ball.app's visual language:
  - a solid brand bar with the wordmark and a centred mark (the Sideline S; see App icon), and a
    title strip in condensed capitals under it
  - thick ink outlines on flat cards (no shadows), chunky round buttons, outlined pill chips and
    buttons
  - diagonal corner ribbons, and team logos inside rings of the team's colour (like Ball.app's
    avatars)
  - big run-style cards in a swipeable "Top picks" carousel with page dots

  The rating badge leads each row and comes first on the game page's rating card. The day heading
  doubles as the date picker: the weekday large, the date under it.
- **Header:** the brand bar is wasabi with `--on-wasabi` text and icons. The title strip under it
  is an ink band, the inverse of the page: nori with rice-paper capitals in light mode, rice paper
  with nori capitals in dark mode (`--strip`, `--on-strip`).
- **Status bar:** the iOS style is `default`, not the `black-translucent` the first Ball version
  used. Translucent draws a white clock and battery straight onto the bar, and white on wasabi is
  2.0:1. With `default`, the clock keeps its own strip above the bar.
- **Selected items are wasabi**, keeping Ball's ink outline. That covers the selected chip, the
  segmented control, the active tab, toggles, primary buttons, the watch pill and the default ribbon.
  Ball filled selected chips with ink; wasabi is the palette's colour for "selected".
- **Badges:**
  - Final and live ratings have an ink outer ring, a thin gap ring and a centre filled with the band
    colour, with the number in the band's own dark ink. Live adds a pulsing ring.
  - A prediction is a band-colour ring around a `--surface` centre, with the number in `--text`.

  Wasabi is never a rating colour, so a Great game never looks like a selected control.
- **Ribbons:** Live is salmon (`--accent`) with `--on-accent` text, and Great game uses the Great
  band with its ink. Favorite, Top pick and Must watch are wasabi. Ribbon edges are always nori.
  Circle this one stays a small salmon badge on Look Ahead.
- **Posters** are split diagonally in the two teams' ESPN colours, with faint paper stripes.
  - The VS (or score) pill and the Grand Prix label are paper with nori ink.
  - The venue line is white with a shadow.
  - The F1 poster is a nori and rice-paper checkered flag.

  These fixed colours (`--nori`, `--rice`, `--paper`, `--on-team`, `--shade`) don't change with the
  theme, because they sit on team colours. Without an ESPN colour, a poster uses
  `--team-fallback-home` / `--team-fallback-away`.
- **Favourites:** a 5px flag on the left of the row and a star, both in `--wasabi-ink`. Plain wasabi
  on white is only 2:1.
- **Type:** the phone's own heavy grotesk (SF Pro on iPhone) for headings and numbers, and Barlow
  Condensed for labels, strips, chips and tabs. Barlow Condensed is under the SIL Open Font License
  and self-hosted in `site/fonts/`, so it works offline and makes no third-party requests.
- **Top picks:** the first three games by Watch Priority (live games first); on past days the three
  best-rated finals ("Best of the day"). Shown when there are at least two candidates and four games.
  The carousel keeps its scroll position while the list refreshes.
- **One token file:** every colour is a custom property in `site/css/tokens.css`:
  - light values on `:root` and `[data-theme="light"]`, dark on `[data-theme="dark"]`
  - the excitement bands, the strip and the fixed colours on `:root` (the same in both modes)

  Components use only `var(--…)` and `color-mix()` of tokens. `app.css` keeps only sizes and fonts.
  `test/colors.test.mjs` fails on any hex, `rgb()` or `hsl()` value in `site/` outside
  `tokens.css`. Team colours arrive from ESPN at runtime, so they never appear as literals.
- **Tokens beyond the spec's table,** so no component keeps a colour of its own:
  - `--strip` / `--on-strip`, and the fixed poster colours above
  - `--logo-bg`, behind logos in their rings. In dark mode it is a step lighter than cards, so dark
    logos still read.
  - `--team-fallback-home/-away/-alt` (posters and charts, when ESPN sends no usable team colour)
  - `--series-1…6` (F1 driver lines)
  - `--pitch-*` and `--shirt-ring` (the soccer lineup pitch)
  - `--knob` (switches)
- **Contrast:** `npm run check:contrast` checks body text at 4.5:1 and large text, icons and focus
  rings at 3:1, in both modes, and `npm test` runs the same check. Small capitals on fills are held
  to 4.5:1: the strip, the VS pill, the Live and Great ribbons, and salmon LIVE text. Four spec values
  fell short. Each was nudged in OKLCH lightness only, so it keeps its hue (`--suggest` prints the
  smallest nudge):

  | Token | Spec | Now | Contrast, spec → now |
  |---|---|---|---|
  | light `--text-3` | #82918B | #64726C | 2.94:1 on `--bg` → 4.50:1 |
  | light `--wasabi-ink` | #5E7A1C | #5C781A | 4.38:1 on `--bg` → 4.51:1 |
  | light `--accent` | #D9694A | #C25536 | white text on it 3.46:1 → 4.52:1 |
  | dark `--text-3` | #6F857E | #80978F | 3.57:1 on `--surface` → 4.51:1 |

- **Charts and lists:** the excitement line is `--wasabi-ink` over a light wasabi area, with dashed
  `--border` lines at the band thresholds. Standings mark each playoff cut with Ball's dashed line.
  Sheets are `--surface` with an ink outline over a 60% `--bg` backdrop.
- **Remove buttons** in Settings are neutral outlined pills, not red: red belongs to the Great band,
  and a removed favourite takes one tap to add back.
- **Look Ahead** lists the home team first for soccer, like Today and the game page. It used to list
  the away team first for every sport.
- **Theme setting:** Settings → Appearance offers System (the default), Light and Dark, saved in
  `localStorage` as `sideline.theme`.
  - Reads and writes are wrapped in try/catch, so blocked storage just means System.
  - The choice becomes `data-theme` on `<html>`, set by a small inline script in `<head>` before
    anything paints, so a Dark choice never flashes light at launch.
  - On System the app follows `prefers-color-scheme` live (iOS switching to dark at sunset, say).
    It re-renders the current screen in place, for logos with dark variants and chart colours.
  - The control is Ball's segmented pill, on its own line under the label.

  `test/theme.test.mjs` covers this with unit tests and a browser test (Playwright; skipped in CI,
  which has no browser).
- **Browser and home screen:**
  - `<meta name="theme-color" content="#A3C14A">` is the one colour literal outside `tokens.css`,
    because the browser reads it before any CSS loads; `js/core/theme.js` then keeps it in step with
    `--wasabi`.
  - `<meta name="color-scheme" content="light dark">` and a `color-scheme` per mode on `:root` keep
    form controls and scrollbars in the right mode.
  - The manifest is JSON and can't read CSS, so it repeats the values: `theme_color` #A3C14A and
    `background_color` #0F1F1C (nori).
  - The icons, favicon and launch screens are the Sideline S; see App icon.
- **Screenshots** are taken by Playwright, with ESPN and OpenF1 requests fetched by Node because
  ESPN's CDN refuses headless Chrome. Team logos need `a.espncdn.com` to be reachable from wherever
  the script runs.

## App icon

The icon is concept #5 from the icon concept sheet, "Sideline S": a bold nori S between two cream
chalk sidelines on wasabi. It is the app icon, favicon, launch screen and header mark. It replaced
the "Scoreboard" icon (HOME 23 / AWAY 9), which shipped briefly in a Ball-style framed version
(commit `a1f484e`) and didn't look good; that replaced the round "S" badge before it.

- **Design:** drawn as in the concept, flat with no frame or stripes:
  - wasabi background
  - cream (`--rice`) sidelines at 18% and 82% of the width, each with five short yard ticks
    pointing inward
  - the S in Space Grotesk Bold (the concept's typeface), nori, centred on its ink box
- **Sources:** `assets/icon/` (not published).
  - `icon-master.svg` is the editable source of truth, with a real `<text>` S. It is square and
    full-bleed with no rounded corners, since iOS and Android apply their own masks.
  - `icon-small.svg` is used for every output 48px and under. It drops the ticks, and has heavier
    lines and a larger S.
  - `icon-mark.svg` is the header mark: the S and sidelines with yard ticks, weighted for about
    40px.
  - `icon-maskable.svg` is generated from the master's `art` group, scaled to 72%. A circle or
    squircle mask never touches the lines or the S; the contact sheet shows both masks and the 80%
    safe zone.
  - The `*-outlined.svg` files are generated and committed. Their text is converted to paths, so
    no renderer needs the font.
- **Build:** `npm run icons` (`scripts/build-icons.mjs`) regenerates everything in one command,
  and the output is byte-for-byte reproducible.
  - It outlines the text with opentype.js. Fonts come from `@fontsource` packages (OFL), looked up
    by family and weight from the SVG. opentype.js 2's own path serialiser can emit `NaN` for valid
    glyphs, so the script serialises the path commands itself and fails on any bad number.
  - It checks that every colour is a token.
  - It renders with resvg.
  - These are dev dependencies only (`npm install`). The app, tests and CI need no install, and CI
    never runs one.
- **Outputs** go in `site/icons/` (the original spec said `public/icons/`, but `site/` is the
  published folder):
  - from the master: `icon-1024` (archive, not precached), `icon-512`, `icon-192` and
    `apple-touch-icon` (180)
  - from the maskable source: `maskable-512` and `maskable-192`
  - from the small variant: `favicon-48`, `favicon-32` and `favicon-16`, and `favicon.svg`
  - `site/favicon.ico` (16, 32 and 48)
  - the review sheet at `docs/screenshots/icon/contact-sheet.png`

  The apple-touch-icon is written as an RGB PNG with no alpha channel at all. The ICO holds PNG
  entries, written by a few lines of code rather than another dependency.
- **Launch screens:** the master icon, with home-screen corner rounding, centred on nori #0F1F1C,
  for nine iPhone sizes.
- **Header mark:** the S between its sidelines, with the yard ticks, drawn straight on the wasabi
  bar. It comes from its own source, `assets/icon/icon-mark.svg`, and is generated as
  `site/js/ui/brand-mark.js` with token colours.
  - The ticks make the lines read as an actual sideline. The lines and ticks are heavier than the
    master's so they hold up at 40px; the favicons stay tick-free, because ticks are noise at 16px.
  - There is no tile or outline. The Scoreboard version sat on an outlined tile, which looked too
    busy; here the bar itself is the field.
  - It sits centred in the bar on every screen (game pages too), at 40px. Centred is the Ball
    layout, and it keeps the mark on screens where Back replaces the wordmark.
- **Wiring:**
  - The manifest (`manifest.webmanifest`, not the spec's `manifest.json`) lists the two "any" and
    two "maskable" PNGs.
  - `<head>` links the SVG favicon, the ICO, the touch icon and the manifest. All paths are
    relative, so they work under the `/ScoresApp/` project path.
  - The ICO link says `sizes="32x32"` rather than `"any"`. With `"any"`, Chrome prefers the ICO
    over the SVG, and modern browsers would never use the SVG.
- **Cache busting:** the icon and manifest URLs carry a version query (`?v=3` since the switch to
  the S), and the service worker's core list caches those exact URLs, plus `tokens.css`, which it
  was missing. Every deploy also stamps a new service-worker cache. iOS keeps the icon from when the
  app was added, so the app must be removed from the Home Screen and added again to show a new one.
- **Checks:**
  - `test/icons.test.mjs` runs in CI and checks:
    - no `<text>` in any shipped SVG, and every colour a token
    - the manifest icons' sizes and purposes match their files
    - the touch icon is 180×180 RGB, and the ICO holds 16, 32 and 48
    - the `<head>` links are relative and exist
    - the header mark has its sidelines and ten yard ticks, and no tile or outline
  - Chrome reports no installability errors for the manifest. Lighthouse 12 dropped its PWA audit;
    Chrome's own check over the DevTools protocol is what that audit reported.
