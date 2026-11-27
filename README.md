# Sideline

A personal, Thuuz-style sports app: scores, stats and a **0–100 excitement rating** for every game,
as an installable PWA for iPhone. Free to run: GitHub Pages for hosting, GitHub Actions for the daily
morning-brief feed, and free data sources (ESPN's public site API, plus OpenF1 for F1).

- **Today:** your favorites pinned on top, then **Live now** ranked by current excitement, then every
  other game ranked by rating. Shows times (Pacific), scores, ratings and where to watch on your
  services. League chips, a date picker, pull-to-refresh, and auto-refresh while games are live.
- **Game page:** score header; rating with a tap-to-explain sheet; excitement curve; win probability;
  linescore, scoring, box score and play-by-play. Soccer adds FotMob-style xG, match stats, momentum
  and lineups on a pitch. F1 adds classification, leader by lap, safety cars and the title race.
- **Look Ahead:** the next 14 days of predictions grouped by day and ordered by Watch Priority, each
  with its horizon label (Prediction, Forecast, Early look), number, likely range and chance of a
  Great game; league and favorites filters; a "Circle this one" list of flagged games further out.
- **Standings:** every league; NFL/NBA/NHL/MLB playoff pictures with the cut line; postseason
  brackets, March Madness and UCL/UEL knockouts when active; F1 drivers and constructors.
- **Morning brief:** `data/brief.json` + `data/brief.md`, refreshed daily before 6:45 am PT. See
  [BRIEF_FEED.md](BRIEF_FEED.md).
- **Appearance:** a bold, outlined, Ball.app-inspired look in the "Wasabi and Nori" palette, in
  light and dark. **Settings → Appearance** picks System (follows the phone, switching live), Light
  or Dark.

Ratings: **0–39 Dull · 40–64 OK · 65–84 Good · 85–100 Great.** An outlined badge is a prediction
(with its likely range underneath); a filled badge is live (pulsing) or final (frozen). 50 is a
median game for its league.

Two numbers per game: the badge always shows **Predicted Excitement** (objective, no personal
boosts). Lists are ordered by **Watch Priority** = prediction + 5 for your favorites + 0–4 star power.

## Run locally

Requires Node 20+. Running the app and the tests needs no `npm install`; the only dependencies are
dev tools for rebuilding the app icon (`npm install`, then `npm run icons`).

```bash
npm run dev
```

Open http://localhost:8080. The app calls ESPN directly from the browser.

```bash
npm test
```

The tests run the rating maths on saved games in `test/fixtures` and never hit the network. They
also check the theme: WCAG contrast of the colour tokens, no colour values outside `tokens.css`, and
the System / Light / Dark setting. The setting also has a browser test, which runs only where
Playwright is installed (not in CI).

Other scripts:

| Command | What it does |
|---|---|
| `npm run probe` | Checks every ESPN endpoint for CORS and available fields → `docs/probe-report.md` |
| `npm run backfill` | Re-scores ~220 recent games per league → `site/data/calibration/*.json` (quick refresh) |
| `npm run brief` | Builds `site/data/brief.json` / `brief.md` now (ignores the morning time gate) |
| `node scripts/build-predictions.mjs --force` | Nightly job by hand: Elo, season simulations, `site/data/predictions.json` (`--leagues nfl,epl` for a subset) |
| `node scripts/backfill-targets.mjs` | Backfills 2–3 seasons of post-game ratings per league into `.cache/targets` (resumable; slow the first time) |
| `node scripts/backtest.mjs` | Walk-forward backtest → `reports/backtest.md`; also refits `config/prediction.json` and rewrites the calibration files (`--no-write` to only report) |
| `node scripts/tune-rating.mjs --search 800` | Searches post-game weights against the labeled fixtures (prints; doesn't edit config) |
| `node scripts/labeled-fixtures.mjs [slug …]` | Downloads the labeled sanity games in `test/fixtures/labeled_games.csv` |
| `npm run fixtures` | Re-downloads the test games in `test/fixtures` |
| `npm run check:contrast` | WCAG contrast of every text/background token pair, light and dark (`-- --suggest` proposes fixes) |
| `npm run icons` | Rebuilds the scoreboard app icon from `assets/icon/`: every PNG size, `favicon.ico` and `favicon.svg`, the header mark, the iPhone launch screens and `docs/screenshots/icon/contact-sheet.png` (run `npm install` once first) |
| `npm run screenshots <label>` | Shoots Today, Look Ahead, a game, Standings and Settings in light and dark → `docs/screenshots/theme/<label>-*.png` (needs `npm run dev` and Playwright) |

Behind a corporate HTTPS proxy, run Node scripts with `NODE_USE_ENV_PROXY=1`.

## Deploy (one time)

1. Push this repo to GitHub as a **public** repository (free Pages needs public, or GitHub Pro).
2. **Settings → Pages → Source: GitHub Actions.**
3. Push to `main`. The **Deploy** workflow runs the tests, then publishes `site/` to
   `https://<user>.github.io/<repo>/`.
4. **Actions → Nightly predictions → Run workflow** once, then **Actions → Morning brief → Run
   workflow**, to publish the first `predictions.json` and `brief.json`. After that both run by
   themselves (predictions ~2 am PT, brief before 6:45 am PT).
5. On your iPhone, open the site in Safari, tap **Share → Add to Home Screen**. iOS keeps the icon
   from when the app was added, so after an icon change, remove the app from the Home Screen and
   add it again to see the new icon.

Workflows:

- `deploy.yml`: runs on every push to `main`.
- `predictions.yml`: runs at 09:37 and 10:37 UTC; the script only works between 1 and 4 am Pacific.
  It caches season schedules between runs (actions/cache), commits `predictions.json` and the Elo
  files, and redeploys.
- `brief.yml`: runs at 12:50 and 13:50 UTC. The script only works between 4 and 9 am Pacific, so
  daylight saving is handled. It commits the brief and redeploys.
- `backfill.yml`: manual. Recalibrates ratings; run it once a season.

## Configuration

Everything you're likely to edit lives in `site/config/`:

| File | What |
|---|---|
| `favorites.js` | Your teams (ESPN team id plus leagues). Pinned on Today, starred, and used by the brief. |
| `services.js` | Your services (`MY_SERVICES`) and which networks each carries (`NETWORKS`, `ALIASES`). |
| `rating.js` | Post-game component weights and amplifiers, bands, calibration curve, novelty bonuses, rivalries. |
| `../css/tokens.css` | Every colour, light and dark: surfaces, text, wasabi, salmon accent and the excitement bands. The only file with colour values; run `npm run check:contrast` after editing. |
| `prediction.json` | Pre-game model: base rates, k, per-sport term tables, Elo settings, horizons, ranges, brief settings, and the backtest's fitted values (`fitted`). |
| `teams.json` | Star power (0–4) per team, for Watch Priority. |

- **Find an ESPN team id:** easiest is **Settings → Add a team** in the app. Otherwise, soccer and
  college team pages show it in the URL (`espn.com/soccer/club/_/id/364/liverpool` → `364`), and
  `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams` lists ids for any league.
- **Settings in the app** (favorites, services, leagues) are stored on the phone. Use **Copy favorites
  as config** to paste them into `favorites.js` so the morning brief matches.
- **Weights** can be changed freely: calibration files store raw component values, so percentiles are
  recomputed with the new weights on load. Run `npm test` afterwards to check the classics still rate
  Great. Bump `version` in `rating.js` when you change the maths, so cached final ratings are recomputed.

## How the rating works

Each game is measured on eight components, each normalized to 0–1. They are combined with the
weights in `rating.js` (stakes also multiplies the result), and placed as a percentile among up to
1,500 backfilled games of the same league (`site/data/calibration/`). The percentile maps to 0–100
so the median game is 50 and the top ~12.5% are 85+.

| Component | What it measures |
|---|---|
| Swing (GEI) | Σ\|ΔWin probability\| normalized by game length: the core. Sampled every 0.5% of the game, late swings weighted more. |
| Late closeness | Share of the final 20% (plus OT) with win probability between 30% and 70%, or within one score. |
| Lead changes | Lead changes and ties, weighted 1 + 2t² so late ones count up to 3×. |
| Comeback | How low the winner's (or, live, the current leader's) win probability fell. |
| Novelty | Overtime, extra innings, shootouts, walk-offs, no-hitters, hat tricks, 40/50-point games, red cards, 15+/17+ point comebacks. |
| Pace | Scoring (and shots, for soccer and hockey) versus league norms. |
| Stakes | Playoffs, elimination games, Game 7s and finals, rivalries, ranked-vs-ranked college games. Scaled by how competitive the game was, and also applied as a multiplier (×(1 + 0.37 × stakes)). |
| Quality | Team quality (records, AP ranks): two good teams beat two bad ones. |

- **Win probability:** ESPN's per-play value is used for NFL, college football, NBA, both college
  basketball leagues and MLB. NHL and soccer use Poisson models from score and time remaining;
  details are in `site/js/rating/wp.js` and DECISIONS.md.
- **Predicted:** see the next section.
- **Live:** w × predicted + (1 − w) × measured so far, w = (1 − progress)². It freezes at the final.
- **F1:** only races are rated: on-track lead changes and passes (pit-stop reshuffles don't count),
  the P1–P2 gap late, a charge through the field, safety cars and red flags, and championship stakes.
- **Explanations:** the sheet lists the components that drove the number, e.g. "3 lead changes, 2 in
  the 4th quarter · 4th quarter within one possession · Overtime".

## How predictions work

Before kickoff each game starts at a league base rate (the league's median rating minus what the
terms add on average, kept separately for the playoffs) and pre-game terms move it up or down (`site/js/predict/`, values in
`config/prediction.json`):

- **Closeness:** the betting line (moneylines with the bookmaker margin removed, or the spread), else
  our own Elo. Coin flips score up, heavy favorites score down ("Heavy favorite (−13.5): blowout risk").
- **Quality** (both teams' Elo percentiles or AP ranks), **importance** (how much the game moves each
  team's playoff/title/relegation odds in a 10,000-run season simulation), **stakes** (playoffs,
  knockouts, second legs), **style** (both teams' scoring environment), **narrative** (rivalries,
  primetime, national TV), **availability** (star or QB out, MLB aces, NHL backup goalies) and
  **weather** (F1 rain, NFL wind/snow, MLB rain).
- **Blowout guard:** a heavy favorite can't be rescued by stakes or narrative (capped at +4).
- Predicted = Base + k × (Raw − Base), with k per league from the backtest; women's college basketball
  uses a ridge regression on the same features because it clearly won out of sample there.
- Each prediction has a **likely range** (the middle half of backtest outcomes for that league and
  horizon) and **P(Great) / P(Dull)** from per-league logistic fits. Pre-game information explains
  only a small part of how exciting a game turns out, so ranges are wide; the useful part is the
  ranking.
- **Horizons:** 0–2 days *Prediction*, 3–7 *Forecast*, 8–14 *Early look* (rounded to 5), 15+ days only a
  **Circle this one** flag when two of five rules hit (two top-20% teams or AP top 10, top-10% stakes,
  a rivalry, a favorite against a quality opponent, a marquee slot).

`reports/backtest.md` has the walk-forward results per league and horizon against three baselines
(constant, spread-only, quality + importance), including where the model doesn't beat them.

## When ESPN changes something

ESPN's API is undocumented. All ESPN knowledge lives in `site/js/adapters/`:

```
adapters/
  espn/client.js     fetch, retries, offline fallback
  espn/parse.js      scoreboard JSON → Game
  espn/summary.js    game summary JSON → GameDetail (plays, win probability, box score, soccer)
  espn/standings.js  standings JSON
  espn/college.js    AP Top 25 + favorites filtering, March Madness
  espn/postseason.js bracket data
  espn/league.js     builds one league's adapter
  nba.js, epl.js …   one file per league (override anything league-specific here)
  f1.js              ESPN schedule/standings + OpenF1 race data
```

If something breaks:

1. Run `npm run probe` and read `docs/probe-report.md`. It shows which endpoints fail (HTTP status),
   whether CORS still allows the browser, and which fields disappeared.
2. **A whole endpoint moved:** change the URL in `espn/league.js`, or override it in that league's file.
3. **A field moved:** fix the parser (`parse.js`, `summary.js` or `standings.js`). The normalized
   model doesn't change, so the UI and rating engine are untouched.
4. **CORS removed:** the app can't call ESPN from the browser any more. The fix is a small free proxy
   (e.g. a Cloudflare Worker that adds `Access-Control-Allow-Origin`). Point `espn/league.js` at it.
5. Run `npm test`. If summaries changed shape, refresh the saved games with `npm run fixtures`.
6. If ratings look off after a data change, re-run **Recalibrate ratings** (`backfill.yml`).

Signs of trouble in the app: a "Couldn't reach ESPN; showing data from …" banner, ratings stuck on
spinners, or a stale **Last data update** in Settings. If `brief.json` has a `date` that isn't today,
or its `errors` list isn't empty, check the Actions tab.

## Project layout

```
site/                 published to GitHub Pages
  index.html, sw.js, manifest.webmanifest, icons/, fonts/ (Barlow Condensed)
  css/                tokens.css (every colour), app.css
  js/core/theme.js    System / Light / Dark setting
  config/             favorites, services, rating weights, prediction model, star teams
  js/app.js           router
  js/app/store.js     loads days, rates and predicts games, caches
  js/ui/              home, game, look ahead, standings, settings, charts
  js/rating/          win-probability models, components, calibration, explanations, F1
  js/predict/         Elo, season simulation, odds, pre-game terms, predictor
  js/adapters/        all external data access (see above)
  data/               calibration/, predictions.json, elo/, brief.json, brief.md, ratings/
scripts/              probe, backfill, brief, predictions, backtest, tuner, fixtures, dev server,
                      icons, contrast check, screenshots
  lib/                season history, Elo walk, standings structure, stats, calibration rows
assets/icon/          app icon sources (scoreboard SVGs; npm run icons builds the rest)
reports/backtest.md   walk-forward backtest (regenerated by scripts/backtest.mjs)
test/                 node:test suites + saved ESPN games + labeled sanity fixtures
.github/workflows/    deploy, nightly predictions, morning brief, recalibration
```
