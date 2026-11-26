// ESPN scoreboard JSON -> normalized Game objects (see site/js/core/model.js for the shape).
// Shared by every ESPN league adapter; league-specific quirks live in the per-league files.

import { LEAGUE_BY_KEY } from '../../core/leagues.js';

const num = (v) => {
  if (v == null || v === '') return null;
  if (typeof v === 'object') v = v.value ?? v.displayValue;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[^\d.+-]/g, ''));
  return Number.isFinite(n) ? n : null;
};

const color = (c) => (c && /^[0-9a-f]{6}$/i.test(c) ? c.toLowerCase() : null);

export function parseTeam(c = {}) {
  const t = c.team || {};
  const logos = t.logos || [];
  const records = Array.isArray(c.records) ? c.records : Array.isArray(c.record) ? c.record : [];
  const overall = records.find((r) => r.type === 'total' || r.name === 'overall' || r.name === 'All Splits') || records[0];
  const rank = c.curatedRank?.current ?? c.rank;
  return {
    id: String(t.id ?? c.id ?? ''),
    abbr: t.abbreviation || '',
    name: t.displayName || t.name || '',
    short: t.shortDisplayName || t.nickname || t.name || t.abbreviation || '',
    location: t.location || '',
    logo: t.logo || logos.find((l) => l.rel?.includes('default'))?.href || logos[0]?.href || '',
    logoDark: t.logoDark || logos.find((l) => l.rel?.includes('dark'))?.href || '',
    color: color(t.color),
    altColor: color(t.alternateColor),
    score: num(c.score),
    shootout: num(c.shootoutScore),
    record: overall?.summary || '',
    rank: rank && rank <= 25 ? rank : null,
    winner: !!c.winner,
    linescores: (c.linescores || []).map((l) => num(l.value ?? l.displayValue) ?? 0),
    hits: num((c.hits ?? null)),
    errors: num((c.errors ?? null)),
    form: c.form || '',
  };
}

const CANCELED = /POSTPONED|CANCELED|CANCELLED|FORFEIT|ABANDONED/;

export function parseStatus(st = {}) {
  const type = st.type || {};
  const name = type.name || '';
  let state = type.state || 'pre';
  if (CANCELED.test(name)) state = 'post';
  return {
    state,
    completed: !!type.completed,
    canceled: CANCELED.test(name),
    suspended: /SUSPENDED|DELAYED/.test(name) && state !== 'post',
    period: st.period || 0,
    clock: st.displayClock || '',
    clockSec: typeof st.clock === 'number' ? st.clock : null,
    detail: type.shortDetail || type.detail || type.description || '',
    description: type.description || '',
    name,
  };
}

/** Broadcasts as [{name, market, type}], TV/streaming only, de-duplicated. */
export function parseBroadcasts(comp = {}) {
  const out = [];
  const seen = new Set();
  const add = (name, market = 'national', type = 'TV') => {
    if (!name) return;
    const k = name.toLowerCase();
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ name, market: String(market).toLowerCase(), type });
  };
  for (const g of comp.geoBroadcasts || []) {
    const type = g.type?.shortName || 'TV';
    if (/radio/i.test(type)) continue;
    add(g.media?.shortName || g.media?.name, g.market?.type, type);
  }
  for (const b of comp.broadcasts || []) {
    for (const n of b.names || []) add(n, b.market);
  }
  return out;
}

function mlToProb(ml) {
  const v = num(ml);
  if (v == null || v === 0) return null;
  return v < 0 ? -v / (-v + 100) : 100 / (v + 100);
}

// Standard deviation of final margin, used to turn a point spread into a win probability.
const SPREAD_SIGMA = { football: 13.5, basketball: 11.5 };

function normCdf(x) {
  // Abramowitz-Stegun approximation.
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989423 * Math.exp((-x * x) / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return x > 0 ? 1 - p : p;
}

/**
 * Pre-game odds -> implied probabilities (vig removed).
 * Returns {home, away, draw, spread, overUnder, details, source} or null.
 */
export function parseOdds(oddsList, sport) {
  const o = Array.isArray(oddsList) ? oddsList[0] : oddsList;
  if (!o) return null;
  const ml = o.moneyline || {};
  const pick = (side) => side?.close?.odds ?? side?.open?.odds;
  let home = mlToProb(pick(ml.home) ?? o.homeTeamOdds?.moneyLine);
  let away = mlToProb(pick(ml.away) ?? o.awayTeamOdds?.moneyLine);
  let draw = mlToProb(pick(ml.draw) ?? o.drawOdds?.moneyLine);
  let source = 'moneyline';
  let spread = num(o.spread);
  // ESPN's `spread` is unsigned-ish; orient it to the home team using the favorite flag.
  if (spread != null) {
    const homeFav = o.homeTeamOdds?.favorite;
    const awayFav = o.awayTeamOdds?.favorite;
    if (homeFav === true) spread = -Math.abs(spread);
    else if (awayFav === true) spread = Math.abs(spread);
  }
  if (home != null && away != null) {
    const total = home + away + (draw || 0);
    home /= total; away /= total; if (draw != null) draw /= total;
  } else if (spread != null && SPREAD_SIGMA[sport]) {
    home = normCdf(-spread / SPREAD_SIGMA[sport]);
    away = 1 - home;
    draw = null;
    source = 'spread';
  } else {
    home = away = draw = null;
  }
  if (home == null && spread == null && o.overUnder == null) return null;
  return {
    home, away, draw, spread,
    overUnder: num(o.overUnder),
    details: o.details || '',
    source,
  };
}

export function parseSeries(raw, competitors) {
  if (!raw) return null;
  const s = Array.isArray(raw) ? (raw.find((x) => x.type === 'current' || x.type === 'playoff') || raw[0]) : raw;
  if (!s) return null;
  const home = competitors?.home?.id;
  const away = competitors?.away?.id;
  // Two-legged soccer ties report aggregate goals instead of series wins.
  if ((s.competitors || []).some((c) => c.aggregateScore != null)) {
    const agg = {};
    for (const c of s.competitors) agg[String(c.id)] = c.aggregateScore ?? null;
    return {
      kind: 'aggregate',
      summary: s.summary || s.description || '',
      title: s.title || '',
      completed: !!s.completed,
      homeAgg: home != null ? agg[home] ?? null : null,
      awayAgg: away != null ? agg[away] ?? null : null,
      homeWins: null, awayWins: null, total: null, toWin: null,
    };
  }
  const wins = {};
  for (const c of s.competitors || []) wins[String(c.id)] = c.wins ?? 0;
  const total = s.totalCompetitions || null;
  return {
    summary: s.summary || s.description || '',
    title: s.title || '',
    completed: !!s.completed,
    homeWins: home != null ? wins[home] ?? 0 : null,
    awayWins: away != null ? wins[away] ?? 0 : null,
    total,
    toWin: total ? Math.floor(total / 2) + 1 : null,
  };
}

function minuteOf(detail) {
  const v = detail?.clock?.value;
  if (typeof v === 'number') return Math.max(1, Math.ceil(v / 60));
  const m = String(detail?.clock?.displayValue || '').match(/(\d+)(?:'\s*\+\s*(\d+))?/);
  return m ? +m[1] + (+m[2] || 0) : null;
}

/** Soccer goals/cards from the scoreboard `details` array. */
export function parseSoccerDetails(details = [], homeId) {
  return details.map((d) => {
    const text = d.type?.text || '';
    let type = 'other';
    if (d.shootout) type = d.scoringPlay ? 'shootout-goal' : 'shootout-miss';
    else if (d.ownGoal) type = 'own-goal';
    else if (d.scoringPlay && d.penaltyKick) type = 'pen-goal';
    else if (d.scoringPlay) type = 'goal';
    else if (d.redCard) type = 'red';
    else if (d.yellowCard) type = 'yellow';
    else if (/penalty.*miss|missed/i.test(text)) type = 'pen-miss';
    const a = d.athletesInvolved?.[0];
    return {
      type,
      text,
      minute: minuteOf(d),
      display: d.clock?.displayValue || '',
      clockSec: typeof d.clock?.value === 'number' ? d.clock.value : null,
      side: String(d.team?.id) === String(homeId) ? 'home' : 'away',
      player: a?.shortName || a?.displayName || '',
    };
  }).filter((d) => d.type !== 'other');
}

/** Live situation: win probability from the last play, possession, down & distance, base runners. */
export function parseSituation(sit, homeId) {
  if (!sit) return null;
  const p = sit.lastPlay?.probability;
  const out = {
    homeWinProb: p?.homeWinPercentage ?? null,
    possession: sit.possession ? (String(sit.possession) === String(homeId) ? 'home' : 'away') : null,
    text: sit.downDistanceText || sit.shortDownDistanceText || '',
    lastPlay: sit.lastPlay?.text || '',
    redZone: !!sit.isRedZone,
  };
  if (sit.outs != null || sit.balls != null) {
    out.baseball = {
      balls: sit.balls ?? 0, strikes: sit.strikes ?? 0, outs: sit.outs ?? 0,
      onFirst: !!sit.onFirst, onSecond: !!sit.onSecond, onThird: !!sit.onThird,
    };
  }
  return out;
}

/** Map one scoreboard event to a Game (team sports). */
export function parseEvent(ev, leagueKey) {
  const lg = LEAGUE_BY_KEY[leagueKey];
  const comp = ev.competitions?.[0] || {};
  const comps = comp.competitors || [];
  const homeC = comps.find((c) => c.homeAway === 'home') || comps[0] || {};
  const awayC = comps.find((c) => c.homeAway === 'away') || comps[1] || {};
  const home = parseTeam(homeC);
  const away = parseTeam(awayC);
  const status = parseStatus(comp.status || ev.status);
  const notes = (comp.notes || []).map((n) => n.headline || n.text).filter(Boolean);
  // Soccer puts the stage ("UEFA Champions League, Final") in altGameNote.
  if (comp.altGameNote && !notes.some((n) => n.includes(comp.altGameNote))) notes.push(comp.altGameNote);
  const game = {
    key: `${leagueKey}:${ev.id}`,
    id: String(ev.id),
    league: leagueKey,
    sport: lg.sport,
    name: ev.name || '',
    shortName: ev.shortName || '',
    start: comp.date || ev.date,
    ...status,
    home,
    away,
    broadcasts: parseBroadcasts(comp),
    odds: parseOdds(comp.odds, lg.sport),
    notes,
    series: parseSeries(comp.series, { home, away }),
    seasonType: ev.season?.type ?? null,
    seasonYear: ev.season?.year ?? null,
    seasonSlug: ev.season?.slug || '',
    week: ev.week?.number ?? null,
    neutral: !!comp.neutralSite,
    conferenceGame: !!comp.conferenceCompetition,
    venue: comp.venue?.fullName || '',
    live: status.state === 'in' ? parseSituation(comp.situation, home.id) : null,
    soccer: lg.sport === 'soccer' ? { events: parseSoccerDetails(comp.details, home.id) } : null,
    groups: comp.groups?.id ? String(comp.groups.id) : null,
  };
  if (lg.sport === 'baseball') {
    game.baseball = {
      homeHits: num(homeC.hits), awayHits: num(awayC.hits),
      homeErrors: num(homeC.errors), awayErrors: num(awayC.errors),
    };
  }
  return game;
}

const F1_SESSIONS = {
  FP1: 'Practice 1', FP2: 'Practice 2', FP3: 'Practice 3',
  Qual: 'Qualifying', SQ: 'Sprint Qualifying', SS: 'Sprint Shootout', Sprint: 'Sprint', Race: 'Race',
};

/** F1: one Game per session (practice, qualifying, sprint, race). Only the race gets rated. */
export function parseF1Event(ev) {
  const out = [];
  const gpName = (ev.shortName || ev.name || '').replace(/^(Formula 1|F1)\s+/i, '');
  for (const comp of ev.competitions || []) {
    const abbr = comp.type?.abbreviation || comp.type?.text || 'Session';
    const status = parseStatus(comp.status || ev.status);
    const drivers = (comp.competitors || [])
      .map((d) => ({
        id: String(d.id),
        order: d.order ?? null,
        name: d.athlete?.displayName || d.athlete?.fullName || '',
        short: d.athlete?.shortName || '',
        flag: d.athlete?.flag?.href || '',
        winner: !!d.winner,
        team: d.team?.displayName || d.vehicle?.manufacturer || '',
      }))
      .sort((a, b) => (a.order ?? 99) - (b.order ?? 99));
    out.push({
      key: `f1:${ev.id}-${comp.id}`,
      id: String(comp.id),
      eventId: String(ev.id),
      league: 'f1',
      sport: 'racing',
      name: `${ev.name} — ${F1_SESSIONS[abbr] || abbr}`,
      gpName: ev.name,
      shortName: gpName,
      session: abbr,
      sessionLabel: F1_SESSIONS[abbr] || abbr,
      isRace: abbr === 'Race',
      start: comp.date || ev.date,
      ...status,
      home: null,
      away: null,
      drivers,
      circuit: ev.circuit?.fullName || '',
      broadcasts: parseBroadcasts(comp),
      odds: null,
      notes: [],
      series: null,
      seasonType: ev.season?.type ?? null,
      seasonYear: ev.season?.year ?? null,
      live: null,
    });
  }
  return out;
}
