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
- **Standings:** every league; NFL/NBA/NHL/MLB playoff pictures with the cut line; postseason
  brackets, March Madness and UCL/UEL knockouts when active; F1 drivers and constructors.
- **Morning brief:** `data/brief.json` + `data/brief.md`, refreshed daily before 6:45 am PT. See
  [BRIEF_FEED.md](BRIEF_FEED.md).

Ratings: **0–39 Dull · 40–64 OK · 65–84 Good · 85–100 Great.** An outlined badge is a prediction; a
filled badge is live (pulsing) or final (frozen). 50 is a median game for its league.

## Run locally

Requires Node 20+ and no `npm install`; there are no dependencies.

```bash
npm run dev
```

Open http://localhost:8080. The app calls ESPN directly from the browser.

```bash
npm test
```

The tests run the rating maths on saved games in `test/fixtures` and never hit the network.

Other scripts:

| Command | What it does |
|---|---|
| `npm run probe` | Checks every ESPN endpoint for CORS and available fields → `docs/probe-report.md` |
| `npm run backfill` | Re-scores ~220 recent games per league → `site/data/calibration/*.json` |
| `npm run brief` | Builds `site/data/brief.json` / `brief.md` now (ignores the morning time gate) |
| `npm run fixtures` | Re-downloads the test games in `test/fixtures` |
| `node scripts/make-icons.mjs` | Re-renders the app icons (needs Playwright) |

Behind a corporate HTTPS proxy, run Node scripts with `NODE_USE_ENV_PROXY=1`.

## Deploy (one time)

1. Push this repo to GitHub as a **public** repository (free Pages needs public, or GitHub Pro).
2. **Settings → Pages → Source: GitHub Actions.**
3. Push to `main`. The **Deploy** workflow runs the tests, then publishes `site/` to
   `https://<user>.github.io/<repo>/`.
4. **Actions → Morning brief → Run workflow** once, to publish the first `brief.json`. After that
   it runs every morning by itself.
5. On your iPhone, open the site in Safari, tap **Share → Add to Home Screen**.

Workflows:

- `deploy.yml`: runs on every push to `main`.
- `brief.yml`: runs at 12:50 and 13:50 UTC. The script only works between 4 and 9 am Pacific, so
  daylight saving is handled. It commits the brief and redeploys.
- `backfill.yml`: manual. Recalibrates ratings; run it once a season.

## Configuration

Everything you're likely to edit lives in `site/config/`:

| File | What |
|---|---|
| `favorites.js` | Your teams (ESPN team id plus leagues). Pinned on Today, starred, and used by the brief. |
| `services.js` | Your services (`MY_SERVICES`) and which networks each carries (`NETWORKS`, `ALIASES`). |
| `rating.js` | Component weights, bands, calibration curve, live blending, novelty bonuses, rivalries. |

- **Find an ESPN team id:** easiest is **Settings → Add a team** in the app. Otherwise, soccer and
  college team pages show it in the URL (`espn.com/soccer/club/_/id/364/liverpool` → `364`), and
  `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams` lists ids for any league.
- **Settings in the app** (favorites, services, leagues) are stored on the phone. Use **Copy favorites
  as config** to paste them into `favorites.js` so the morning brief matches.
- **Weights** can be changed freely: calibration files store raw component values, so percentiles are
  recomputed with the new weights on load. Run `npm test` afterwards to check the classics still rate
  Great. Bump `version` in `rating.js` when you change the maths, so cached final ratings are recomputed.

## How the rating works

Each game is measured on seven components, each normalized to 0–1. They are combined with the
weights in `rating.js`, and the result is placed as a percentile among ~200 recent games of the same
league (`site/data/calibration/`). The percentile maps to 0–100 so the median game is 50 and the top
~12.5% are 85+.

| Component | What it measures |
|---|---|
| Swing (GEI) | Σ\|ΔWin probability\| normalized by game length: the core. Sampled every 0.5% of the game, late swings weighted more. |
| Late closeness | Share of the final 20% (plus OT) with win probability between 30% and 70%, or within one score. |
| Lead changes | Lead changes and ties, weighted 1 + 2t² so late ones count up to 3×. |
| Comeback | How low the winner's (or, live, the current leader's) win probability fell. |
| Novelty | Overtime, extra innings, shootouts, walk-offs, no-hitters, hat tricks, 40/50-point games, red cards, 15+/17+ point comebacks. |
| Pace | Scoring (and shots, for soccer and hockey) versus league norms. |
| Stakes | Playoffs, elimination games, Game 7s and finals, rivalries, ranked-vs-ranked college games. |

- **Win probability:** ESPN's per-play value is used for NFL, college football, NBA, both college
  basketball leagues and MLB. NHL and soccer use Poisson models from score and time remaining;
  details are in `site/js/rating/wp.js` and DECISIONS.md.
- **Predicted:** closeness from betting odds (or records), team quality, rivalry, stakes, rankings.
- **Live:** blends the prediction with in-game signals, shifting toward the in-game rating as the
  game goes on. It freezes at the final.
- **F1:** only races are rated: lead changes, overtakes, the P1–P2 gap late, safety cars and red
  flags, and championship stakes.
- **Explanations:** the sheet lists the components that drove the number, e.g. "3 lead changes, 2 in
  the 4th quarter · 4th quarter within one possession · Overtime".

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
  index.html, sw.js, manifest.webmanifest, icons/, css/
  config/             favorites, services, rating weights
  js/app.js           router
  js/app/store.js     loads days, rates games, caches
  js/ui/              home, game, standings, settings, charts
  js/rating/          win-probability models, components, calibration, explanations, F1
  js/adapters/        all external data access (see above)
  data/               calibration/, brief.json, brief.md, ratings/
scripts/              probe, backfill, brief, fixtures, dev server, icons
test/                 node:test suites + saved ESPN games
.github/workflows/    deploy, morning brief, recalibration
```
