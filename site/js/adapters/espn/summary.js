// ESPN game summary JSON -> normalized GameDetail.
// The detail carries everything the game page renders and everything the rating engine needs:
// a play list with a common time axis `t` (0 = kickoff, 1 = end of regulation, >1 = overtime),
// ESPN's win-probability series when it exists, scoring, box scores, team stats and soccer extras.

import { LEAGUE_BY_KEY } from '../../core/leagues.js';
import { clockT, soccerT, soccerMinuteT, baseballT } from '../../core/gametime.js';
import { parseTeam, parseStatus, parseOdds, parseSeries } from './parse.js';

const sideOf = (teamId, game) => {
  if (teamId == null || !game?.home) return null;
  const id = String(teamId);
  if (id === game.home.id) return 'home';
  if (id === game.away.id) return 'away';
  return null;
};

// ---------- time axis ----------

/** Make a time axis non-decreasing (ESPN occasionally labels boundary rows oddly). */
function monotonic(list) {
  let prev = 0;
  for (const p of list) {
    if (p.t == null || !Number.isFinite(p.t) || p.t < prev) p.t = prev;
    prev = p.t;
  }
  return list;
}

// ---------- header ----------

function headerGame(json, leagueKey, base) {
  const lg = LEAGUE_BY_KEY[leagueKey];
  const comp = json.header?.competitions?.[0];
  if (!comp) return base;
  const cs = comp.competitors || [];
  const homeC = cs.find((c) => c.homeAway === 'home') || cs[0];
  const awayC = cs.find((c) => c.homeAway === 'away') || cs[1];
  const home = { ...(base?.home || {}), ...pickDefined(parseTeam(homeC)) };
  const away = { ...(base?.away || {}), ...pickDefined(parseTeam(awayC)) };
  // Keep scoreboard-only fields (AP rank, logos) when the summary header lacks them.
  for (const [t, b] of [[home, base?.home], [away, base?.away]]) {
    if (!b) continue;
    if (!t.logo) t.logo = b.logo;
    if (b.rank && !t.rank) t.rank = b.rank;
    if (!t.record) t.record = b.record;
  }
  const status = parseStatus(comp.status);
  return {
    ...(base || {}),
    key: base?.key || `${leagueKey}:${json.header?.id}`,
    id: base?.id || String(json.header?.id),
    league: leagueKey,
    sport: lg.sport,
    start: base?.start || comp.date,
    ...status,
    home,
    away,
    neutral: comp.neutralSite ?? base?.neutral,
    series: parseSeries(comp.series, { home, away }) || base?.series || null,
    notes: base?.notes?.length ? base.notes : (comp.notes || []).map((n) => n.headline).filter(Boolean),
    seasonType: base?.seasonType ?? json.header?.season?.type ?? null,
    seasonSlug: base?.seasonSlug || json.header?.season?.slug || '',
  };
}

function pickDefined(o) {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null && v !== '' && !(Array.isArray(v) && !v.length)));
}

// ---------- plays per sport ----------

function basketballOrFootballPlays(rawPlays, lg, game) {
  const otMinutes = lg.otMinutes;
  const out = [];
  // College football overtime has no clock: spread OT plays evenly inside a nominal OT period.
  const noClockOt = lg.key === 'cfb';
  const otIdx = {};
  if (noClockOt) {
    for (const p of rawPlays) {
      const per = p.period?.number || 1;
      if (per > lg.periods) otIdx[per] = (otIdx[per] || 0) + 1;
    }
  }
  const otSeen = {};
  for (const p of rawPlays) {
    const period = p.period?.number || 1;
    let t;
    if (noClockOt && period > lg.periods) {
      otSeen[period] = (otSeen[period] || 0) + 1;
      const frac = otSeen[period] / (otIdx[period] + 1);
      t = 1 + ((period - lg.periods - 1) + frac) * (otMinutes * 60) / (lg.periods * lg.periodMinutes * 60);
    } else {
      t = clockT(lg, period, p.clock?.displayValue, { clockMode: 'remaining' });
    }
    out.push({
      id: String(p.id),
      period,
      clock: p.clock?.displayValue || '',
      t,
      hs: p.homeScore ?? null,
      as: p.awayScore ?? null,
      text: p.text || p.shortText || '',
      type: p.type?.text || '',
      scoring: !!p.scoringPlay,
      value: p.scoreValue ?? null,
      side: sideOf(p.team?.id, game),
      athlete: p.participants?.[0]?.athlete?.displayName || null,
    });
  }
  return out;
}

function footballRawPlays(json) {
  const drives = [...(json.drives?.previous || [])];
  if (json.drives?.current) drives.push(json.drives.current);
  const plays = [];
  const seen = new Set();
  for (const d of drives) {
    for (const p of d.plays || []) {
      if (seen.has(p.id)) continue;
      seen.add(p.id);
      plays.push({ ...p, team: p.team || d.team });
    }
  }
  plays.sort((a, b) => (+a.sequenceNumber || 0) - (+b.sequenceNumber || 0));
  return plays;
}

function hockeyPlays(json, lg, game) {
  const playoff = game?.seasonType === 3;
  return (json.plays || []).map((p) => {
    const period = p.period?.number || 1;
    const shootout = !playoff && period >= 5;
    const t = shootout
      ? 1 + (5 * 60) / 3600 + 0.01
      : clockT(lg, period, p.clock?.displayValue, { clockMode: 'elapsed', otMinutes: playoff ? 20 : 5 });
    const typeText = p.type?.text || '';
    return {
      id: String(p.id),
      period,
      clock: p.clock?.displayValue || '',
      t,
      hs: p.homeScore ?? null,
      as: p.awayScore ?? null,
      text: p.text || '',
      type: typeText,
      scoring: !!p.scoringPlay,
      shot: !!p.shootingPlay,
      onGoal: typeText === 'Shot' || typeText === 'Goal',
      shootout,
      strength: p.strength?.abbreviation || null,
      side: sideOf(p.team?.id, game),
      athlete: p.participants?.[0]?.athlete?.displayName || null,
    };
  });
}

function baseballPlays(json, game) {
  return (json.plays || []).map((p) => {
    const inning = p.period?.number || 1;
    const half = /bot/i.test(p.period?.type || '') ? 'bottom' : 'top';
    const typeText = p.type?.text || '';
    return {
      id: String(p.id),
      period: inning,
      half,
      clock: `${half === 'top' ? 'Top' : 'Bot'} ${inning}`,
      t: baseballT(inning, half, p.outs),
      outs: p.outs ?? null,
      hs: p.homeScore ?? null,
      as: p.awayScore ?? null,
      text: p.text || '',
      type: typeText,
      scoring: !!p.scoringPlay,
      result: p.type?.type === 'play-result' || typeText === 'Play Result' || /^(Single|Double|Triple|Home Run)$/.test(typeText),
      hit: /^(Single|Double|Triple|Home Run)$/.test(typeText) || /\b(singled|doubled|tripled|homered)\b/.test(p.text || ''),
      // Batting side: visitors bat in the top half.
      side: half === 'top' ? 'away' : 'home',
      summaryType: p.summaryType || null,
    };
  });
}

/** Soccer: commentary (every shot, corner, card) + key events (goals, cards) on one axis. */
function soccerTimeline(json, game) {
  const homeName = game?.home?.name;
  const awayName = game?.away?.name;
  const sideByName = (n) => (n && n === homeName ? 'home' : n && n === awayName ? 'away' : null);
  const commentary = (json.commentary || [])
    .slice()
    .sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0))
    .map((c) => {
      const p = c.play || {};
      const period = p.period?.number || 1;
      const clock = c.time?.displayValue || p.clock?.displayValue || '';
      const minuteT = soccerMinuteT(clock);
      return {
        id: String(p.id ?? `c${c.sequence}`),
        seq: c.sequence,
        period,
        clock,
        t: minuteT ?? (p.clock?.value != null ? soccerT(period, p.clock.value) : null),
        text: c.text || p.text || '',
        type: p.type?.type || '',
        side: sideOf(p.team?.id, game) || sideByName(p.team?.displayName),
      };
    });
  const keyEvents = (json.keyEvents || []).map((k) => {
    const period = k.period?.number || 1;
    const clock = k.clock?.displayValue || '';
    const shootout = !!k.shootout || period >= 5;
    return {
      id: String(k.id),
      period,
      clock,
      t: shootout ? 1 + 30 / 90 + 0.01 : (soccerMinuteT(clock) ?? (k.clock?.value != null ? soccerT(period, k.clock.value) : null)),
      text: k.text || '',
      type: k.type?.type || '',
      scoring: !!k.scoringPlay,
      shootout,
      side: sideOf(k.team?.id, game) || sideByName(k.team?.displayName),
      athlete: k.participants?.[0]?.athlete?.displayName || null,
    };
  });
  return { commentary: monotonic(commentary), keyEvents: monotonic(keyEvents) };
}

/** "Goal! Brentford 1, Everton 0. ..." / "Own Goal by X, Team. Home 2, Away 0." -> [home, away] */
export function scoreFromGoalText(text = '') {
  const s = text
    .replace(/^Own Goal by [^.]*\.\s*/i, '')
    .replace(/^Goal!\s*/i, '')
    .replace(/^Penalty [^.]*\.\s*/i, '');
  const m = s.match(/^(.+?)\s(\d+),\s(.+?)\s(\d+)\./);
  return m ? [+m[2], +m[4]] : null;
}

/** Running score after each soccer goal (ESPN commentary lists the home team first). */
function soccerScores(keyEvents, game) {
  const goals = keyEvents.filter((k) => k.scoring && !k.shootout);
  let hs = 0;
  let as = 0;
  const out = [];
  for (const g of goals) {
    const parsed = scoreFromGoalText(g.text);
    if (parsed && parsed[0] + parsed[1] === hs + as + 1) [hs, as] = parsed;
    else if (g.side === 'home') hs++;
    else if (g.side === 'away') as++;
    out.push({ ...g, hs, as });
  }
  // Own goals can be attributed to either side; trust the final score if our tally disagrees.
  if (game?.home?.score != null && out.length && game.state === 'post') {
    const last = out[out.length - 1];
    if (last.hs !== game.home.score || last.as !== game.away.score) {
      if (last.hs === game.away.score && last.as === game.home.score) {
        for (const g of out) [g.hs, g.as] = [g.as, g.hs];
      }
    }
  }
  return out;
}

// ---------- box score & stats ----------

function parseBox(json, game) {
  const teams = json.boxscore?.players || [];
  if (!teams.length) return null;
  return teams.map((t) => ({
    side: sideOf(t.team?.id, game) || 'away',
    abbr: t.team?.abbreviation || '',
    groups: (t.statistics || []).map((g) => ({
      name: g.name || g.type || '',
      title: g.text || g.name || g.type || '',
      labels: g.labels || [],
      keys: g.keys || [],
      totals: g.totals || [],
      rows: (g.athletes || []).map((a) => ({
        id: String(a.athlete?.id ?? ''),
        name: a.athlete?.displayName || '',
        short: a.athlete?.shortName || a.athlete?.displayName || '',
        pos: a.athlete?.position?.abbreviation || a.position?.abbreviation || '',
        starter: !!a.starter,
        dnp: !!a.didNotPlay,
        reason: a.reason || '',
        stats: a.stats || [],
      })),
    })).filter((g) => g.rows.length),
  }));
}

function parseTeamStats(json, game) {
  const teams = json.boxscore?.teams || [];
  if (teams.length < 2) return null;
  const bySide = {};
  for (const t of teams) bySide[sideOf(t.team?.id, game) || (t.homeAway === 'home' ? 'home' : 'away')] = t;
  const home = bySide.home?.statistics || [];
  const away = bySide.away?.statistics || [];
  const rows = [];
  const seen = new Set();
  for (const s of home) {
    const key = s.name || s.label;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const a = away.find((x) => (x.name || x.label) === key);
    rows.push({ key, label: s.label || s.abbreviation || key, home: s.displayValue ?? '', away: a?.displayValue ?? '' });
  }
  return rows.length ? rows : null;
}

/** Soccer lineups with formation; starters ordered by formation place. */
function parseLineups(json, game) {
  const rosters = json.rosters || [];
  if (!rosters.length || game?.sport !== 'soccer') return null;
  const out = {};
  for (const r of rosters) {
    const side = sideOf(r.team?.id, game) || r.homeAway;
    const players = (r.roster || []).map((p) => ({
      name: p.athlete?.displayName || '',
      short: p.athlete?.shortName || p.athlete?.lastName || p.athlete?.displayName || '',
      jersey: p.jersey || '',
      pos: p.position?.abbreviation || '',
      place: +p.formationPlace || 0,
      starter: !!p.starter,
      subbedIn: !!p.subbedIn,
      subbedOut: !!p.subbedOut,
      goals: statVal(p.stats, 'totalGoals'),
      yellow: statVal(p.stats, 'yellowCards'),
      red: statVal(p.stats, 'redCards'),
    }));
    out[side] = {
      formation: r.formation || '',
      starters: players.filter((p) => p.starter).sort((a, b) => a.place - b.place),
      subs: players.filter((p) => !p.starter),
    };
  }
  return out.home || out.away ? out : null;
}

function statVal(stats, name) {
  const s = (stats || []).find((x) => x.name === name);
  return s ? +s.value || 0 : 0;
}

/** Baseball lineups (batting order) from rosters. */
function parseBaseballLineups(json, game) {
  if (game?.sport !== 'baseball') return null;
  const out = {};
  for (const r of json.rosters || []) {
    const side = sideOf(r.team?.id, game) || r.homeAway;
    out[side] = (r.roster || [])
      .filter((p) => p.starter || p.batOrder)
      .sort((a, b) => (a.batOrder || 99) - (b.batOrder || 99))
      .map((p) => ({ name: p.athlete?.displayName || '', pos: p.position?.abbreviation || '', order: p.batOrder || null }));
  }
  return out.home || out.away ? out : null;
}

// ---------- win probability ----------

function parseWp(json, plays) {
  const raw = json.winprobability || [];
  if (raw.length < 2) return null;
  const tById = new Map(plays.map((p) => [p.id, p]));
  const pts = [];
  let lastT = 0;
  for (const w of raw) {
    const p = tById.get(String(w.playId));
    let t = p ? p.t : null;
    if (t == null) t = lastT; // unknown play: keep position
    lastT = Math.max(lastT, t);
    pts.push({ t: Math.max(t, lastT), wp: Math.min(1, Math.max(0, w.homeWinPercentage ?? 0.5)), tie: w.tiePercentage || 0 });
  }
  return pts;
}

// ---------- consistency ----------

/**
 * ESPN sometimes reverses homeScore/awayScore in the play-by-play of neutral-site games while
 * the header has the official home team (seen: 2026 Toledo vs Michigan, Baha Mar). Check which
 * team actually scored each basket/goal/run (and the final score) and swap the play scores back.
 * Also drops ESPN's win-probability series when it was built on reversed scores or ends on the
 * wrong winner.
 */
export function fixReversedSides(detail) {
  const g = detail.game;
  if (detail.sport === 'soccer' || !g?.home || !g?.away) return detail;
  let agree = 0;
  let disagree = 0;
  let hs = 0;
  let as = 0;
  let last = null;
  for (const p of detail.plays || []) {
    if (p.hs == null || p.as == null) continue;
    const dh = p.hs - hs;
    const da = p.as - as;
    if (p.side && (dh > 0) !== (da > 0)) {
      if ((dh > 0 ? 'home' : 'away') === p.side) agree++;
      else disagree++;
    }
    hs = p.hs;
    as = p.as;
    last = p;
  }
  const fh = Number(g.home.score);
  const fa = Number(g.away.score);
  const final = g.state === 'post' && Number.isFinite(fh) && Number.isFinite(fa) && fh !== fa;
  const finalSwapped = final && last && last.hs === fa && last.as === fh;
  const finalMatches = final && last && last.hs === fh && last.as === fa;
  if (!finalMatches && ((disagree >= 3 && disagree > agree * 2) || (finalSwapped && disagree >= agree))) {
    for (const p of detail.plays) {
      if (p.hs == null || p.as == null) continue;
      [p.hs, p.as] = [p.as, p.hs];
    }
    detail.sidesFixed = true;
  }
  // ESPN's win probability was computed on the same reversed scores (or otherwise ends on the
  // wrong winner): it can't be repaired, so drop it and let our score/time model rebuild it.
  if (detail.wp?.length) {
    const end = detail.wp[detail.wp.length - 1].wp;
    if (detail.sidesFixed || (final && ((fh > fa && end < 0.1) || (fa > fh && end > 0.9)))) {
      detail.wp = null;
      detail.wpDropped = true;
    }
  }
  return detail;
}

// ---------- public ----------

/**
 * Normalize a summary response.
 * @param {object} json   raw ESPN summary
 * @param {string} leagueKey
 * @param {object} [baseGame] the Game from the scoreboard, if available (keeps AP ranks etc.)
 */
export function parseSummary(json, leagueKey, baseGame) {
  const lg = LEAGUE_BY_KEY[leagueKey];
  const game = headerGame(json, leagueKey, baseGame);
  const detail = {
    key: game.key,
    league: leagueKey,
    sport: lg.sport,
    game,
    plays: [],
    wp: null,
    box: parseBox(json, game),
    teamStats: parseTeamStats(json, game),
    odds: parseOdds(json.pickcenter, lg.sport) || game.odds || null,
    predictor: json.predictor ? {
      home: (parseFloat(json.predictor.homeTeam?.gameProjection) || null) / 100 || null,
      away: (parseFloat(json.predictor.awayTeam?.gameProjection) || null) / 100 || null,
    } : null,
    venue: json.gameInfo?.venue?.fullName || game.venue || '',
    attendance: json.gameInfo?.attendance || null,
    soccer: null,
    baseball: null,
  };

  switch (lg.sport) {
    case 'basketball':
      detail.plays = basketballOrFootballPlays(json.plays || [], lg, game);
      break;
    case 'football':
      detail.plays = basketballOrFootballPlays(footballRawPlays(json), lg, game);
      detail.drives = (json.drives?.previous || []).map((d) => ({
        side: sideOf(d.team?.id, game),
        result: d.displayResult || d.result || '',
        description: d.description || '',
        plays: (d.plays || []).length,
        score: !!d.isScore,
      }));
      break;
    case 'hockey':
      detail.plays = hockeyPlays(json, lg, game);
      break;
    case 'baseball':
      detail.plays = baseballPlays(json, game);
      detail.baseball = { lineups: parseBaseballLineups(json, game) };
      break;
    case 'soccer': {
      const { commentary, keyEvents } = soccerTimeline(json, game);
      const goals = soccerScores(keyEvents, game);
      detail.plays = commentary;
      detail.soccer = {
        keyEvents,
        goals,
        lineups: parseLineups(json, game),
        xg: null, // filled from the core API by the adapter (see espn/league.js)
        advanced: null,
      };
      break;
    }
    default:
      break;
  }
  monotonic(detail.plays);
  detail.wp = parseWp(json, detail.plays);
  fixReversedSides(detail);
  return detail;
}
