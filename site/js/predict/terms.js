// Pre-game point terms, per sport, from config/prediction.json. Each term:
//   { key, group, points, text }
// group is one of: closeness, quality, importance, stakes, style, narrative, availability,
// matchup, weather, total. Terms never read anything known after kickoff.

import CFG from '../../config/prediction.json' with { type: 'json' };
import RATING from '../../config/rating.js';
import { LEAGUE_BY_KEY } from '../core/leagues.js';
import { spreadInfo } from './odds.js';
import { probabilities, spreadFromElo } from './elo.js';

const S = CFG.sports;
const fmt = (x) => (Number.isInteger(x) ? String(x) : x.toFixed(1));
const pct = (x) => `${Math.round(x * 100)}%`;

/** Bucketed lookup: first [limit, points] with value <= limit. */
export function step(table, x) {
  for (const [lim, pts] of table) if (x <= lim + 1e-9) return pts;
  return table[table.length - 1][1];
}

export function family(league) {
  const sport = LEAGUE_BY_KEY[league]?.sport;
  if (league === 'mlb') return 'mlb';
  if (league === 'nhl') return 'nhl';
  if (sport === 'soccer') return 'soccer';
  if (sport === 'racing') return 'f1';
  return league; // nfl, cfb, nba, mcbb, wcbb
}

/** Win probabilities for the matchup: market first, Elo otherwise. */
export function matchup(game, ctx) {
  const o = game.odds;
  if (o && o.home != null && o.away != null) {
    return { source: 'market', home: o.home, away: o.away, draw: o.draw || 0 };
  }
  if (ctx.elo?.home != null && ctx.elo?.away != null) {
    const p = probabilities(ctx.elo.home, ctx.elo.away, game.league, { neutral: !!game.neutral });
    return { source: 'elo', home: p.home, away: p.away, draw: p.draw, diff: p.diff };
  }
  return { source: 'none', home: null, away: null, draw: null };
}

function isPostseason(game) {
  return game.seasonType === 3 || !!game.tournament || /final|semifinal|quarterfinal|round-of|knockout|playoff/i.test(game.seasonSlug || '');
}

/** Series state before the game. Callers pass pregameView(game), whose series is already pre-game. */
function seriesBefore(game) {
  const s = game.series;
  if (!s || s.homeWins == null || !s.toWin) return null;
  return { h: s.homeWins, a: s.awayWins, toWin: s.toWin };
}

function isRivalry(game) {
  const pairs = RATING.rivalries[game.league] || [];
  const h = game.home?.id;
  const a = game.away?.id;
  return pairs.some(([x, y]) => (x === h && y === a) || (x === a && y === h));
}

const NATIONAL = /^(ABC|ESPN|ESPN2|TNT|TBS|truTV|NBC|CBS|FOX|FS1|Prime Video|Peacock|Netflix|NBA TV|NFL Network|MLB Network|NHL Network|Apple TV|HBO Max)$/i;

function nationalTv(game) {
  return (game.broadcasts || []).some((b) => b.market === 'national' && NATIONAL.test(b.name));
}

function etHour(iso) {
  const p = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hourCycle: 'h23' }).formatToParts(new Date(iso));
  return +p.find((x) => x.type === 'hour').value;
}

// ---------------- closeness ----------------

function closenessTerms(game, ctx, m) {
  const fam = family(game.league);
  const out = [];
  const home = game.home;
  const away = game.away;
  if (fam === 'soccer') {
    if (m.home == null) return out;
    const gap = Math.abs(m.home - m.away);
    const pts = step(S.soccer.gap, gap);
    const fav = m.home >= m.away ? home : away;
    const text = gap <= 0.15 ? 'Evenly matched (win chances within 15%)'
      : pts < 0 ? `${fav?.short || 'Favorite'} heavily favored (${pct(Math.max(m.home, m.away))})`
        : `${fav?.short || 'Favorite'} slight favorite`;
    out.push({ key: 'closeness', group: 'closeness', points: pts, text });
    const ou = game.odds?.overUnder;
    if (m.draw >= S.soccer.boringDraw.pDraw && ou != null && ou <= S.soccer.boringDraw.total) {
      out.push({ key: 'boringDraw', group: 'closeness', points: S.soccer.boringDraw.points, text: 'High draw chance, low total' });
    }
    if (ou != null) {
      if (ou >= S.soccer.goalsLine.high) out.push({ key: 'total', group: 'total', points: S.soccer.goalsLine.highPts, text: `Goals expected (over/under ${fmt(ou)})` });
      else if (ou <= S.soccer.goalsLine.low) out.push({ key: 'total', group: 'total', points: S.soccer.goalsLine.lowPts, text: `Low-scoring line (${fmt(ou)})` });
    }
    return out;
  }
  if (fam === 'mlb' || fam === 'nhl') {
    if (m.home == null) return out;
    const pf = Math.max(m.home, m.away);
    const pts = step(S[fam].moneyline, pf);
    const fav = m.home >= m.away ? home : away;
    out.push({
      key: 'closeness', group: 'closeness', points: pts,
      text: pf <= 0.55 ? `Toss-up (${fav?.abbr || 'fav'} ${pct(pf)})` : pts < 0 ? `${fav?.short || 'Favorite'} heavy favorite (${pct(pf)})` : `${fav?.short || 'Favorite'} favored (${pct(pf)})`,
    });
    if (fam === 'mlb' && game.odds?.overUnder != null) {
      const ou = game.odds.overUnder;
      if (ou >= 10) out.push({ key: 'total', group: 'total', points: S.mlb.totalMax, text: `High total (${fmt(ou)})` });
      else if (ou <= 7) out.push({ key: 'total', group: 'total', points: -S.mlb.totalMax, text: `Pitchers' duel line (${fmt(ou)})` });
    }
    return out;
  }
  // Football and basketball: point spread (market, else Elo-implied).
  const spreadTable = S[fam]?.spread;
  if (!spreadTable) return out;
  let abs = null;
  let text = '';
  const market = m.source === 'market' ? spreadInfo(game.odds, home, away) : null;
  if (market) {
    abs = market.abs;
    text = abs <= 3 ? `Coin-flip line (${market.text})` : `${market.text}`;
  } else if (m.source === 'elo' || m.diff != null) {
    const sp = spreadFromElo(m.diff ?? 0, game.league);
    if (sp != null) {
      abs = Math.round(Math.abs(sp) * 2) / 2;
      const fav = sp <= 0 ? home : away;
      text = abs <= 3 ? `Even matchup by rating (~${fmt(abs)} pts)` : `${fav?.short || 'Favorite'} by ~${fmt(abs)} on rating`;
    }
  } else if (m.home != null) {
    // Moneyline only: convert to an approximate spread through the margin model's sigma.
    const pf = Math.max(m.home, m.away);
    abs = Math.round(((pf - 0.5) * 2 * 14) * 2) / 2;
    text = `Favorite at ${pct(pf)}`;
  }
  if (abs == null) return out;
  const pts = step(spreadTable, abs);
  if (pts <= -7) text = `${market ? `Heavy favorite (${market.text.replace(/^\S+\s/, '')})` : text}: blowout risk`;
  out.push({ key: 'closeness', group: 'closeness', points: pts, text, spread: abs });
  const total = game.odds?.overUnder;
  const tcfg = S[fam]?.total;
  if (total != null && tcfg) {
    if (tcfg.high != null && total >= tcfg.high) out.push({ key: 'total', group: 'total', points: tcfg.highPts, text: `High total (${fmt(total)})` });
    else if (tcfg.low != null && total <= tcfg.low) out.push({ key: 'total', group: 'total', points: tcfg.lowPts, text: `Low total (${fmt(total)})` });
  }
  return out;
}

// ---------------- quality ----------------

function qualityTerm(game, ctx) {
  const p = ctx.eloPct;
  if (!p || p.home == null || p.away == null) return null;
  const h = Math.max(0.01, p.home);
  const a = Math.max(0.01, p.away);
  const hm = (2 * h * a) / (h + a);
  if (p.home < 0.25 && p.away < 0.25) return { key: 'quality', group: 'quality', points: CFG.quality.bottomQuartileBoth, text: 'Two bottom-quartile teams', hm };
  const pts = Math.round(Math.max(0, (hm - 0.5) / 0.5) * CFG.quality.max * 10) / 10;
  if (pts <= 0) return { key: 'quality', group: 'quality', points: 0, text: '', hm };
  const n = ctx.leagueSize || 30;
  const rk = (x) => Math.max(1, Math.round((1 - x) * n) + 1);
  const worst = Math.max(rk(p.home), rk(p.away));
  const text = worst <= 5 ? 'Two top-5 teams by rating' : worst <= 10 ? 'Two top-10 teams by rating' : 'Two good teams by rating';
  return { key: 'quality', group: 'quality', points: pts, text, hm };
}

// ---------------- importance ----------------

function importanceTerm(game, ctx) {
  const imp = ctx.importance;
  if (!imp) return null;
  const fam = family(game.league);
  if (imp.dead) {
    return { key: 'importance', group: 'importance', points: CFG.importance.deadRubber, text: fam === 'nfl' ? 'Dead rubber: both eliminated' : 'Dead rubber: nothing at stake for either team' };
  }
  const swing = imp.swing || 0;
  let pts;
  if (fam === 'nfl') pts = step(S.nfl.playoffSwing.map(([lim, p]) => [-lim, p]).concat([[Infinity, 0]]), -swing);
  else {
    const cap = fam === 'nba' ? S.nba.seedingLeverage : fam === 'mlb' ? S.mlb.raceSwing : fam === 'nhl' ? S.nhl.raceSwing : fam === 'soccer' ? S.soccer.tableLeverage : CFG.importance.max;
    pts = swing >= 40 ? cap : swing >= 20 ? 0.6 * cap : swing >= 10 ? 0.3 * cap : 0;
  }
  pts = Math.round(pts * 10) / 10;
  if (!pts) return { key: 'importance', group: 'importance', points: 0, text: '', swing };
  const top = imp.top;
  const what = top?.label ? `${top.label.charAt(0).toUpperCase()}${top.label.slice(1)}` : 'Standings';
  const team = top?.side === 'home' ? game.home?.short : top?.side === 'away' ? game.away?.short : '';
  return { key: 'importance', group: 'importance', points: pts, text: `${what} race on the line${team ? ` for ${team}` : ''} (±${Math.round(top ? top.swing * 100 : swing)}% odds)`, swing };
}

// ---------------- stakes (postseason, ranked matchups, legs) ----------------

function stakesTerms(game, ctx) {
  const fam = family(game.league);
  const notes = (game.notes || []).join(' · ');
  const out = [];
  const add = (points, text, key = 'stakes') => out.push({ key, group: 'stakes', points, text });
  const sb = seriesBefore(game);
  if (fam === 'nfl' && isPostseason(game)) {
    const pc = S.nfl.postseason;
    if (/super bowl/i.test(notes)) add(pc.superbowl, 'Super Bowl');
    else if (/conference|championship|afc champ|nfc champ/i.test(notes)) add(pc.conference, 'Conference championship');
    else if (/divisional/i.test(notes)) add(pc.divisional, 'Divisional round');
    else add(pc.wildcard, 'Wild Card round');
  }
  if (fam === 'nba' && sb) {
    const need = sb.toWin - 1;
    if (sb.h === need && sb.a === need) add(S.nba.playoffs.game7, `Game ${sb.h + sb.a + 1}: winner takes the series`);
    else if (sb.h === need || sb.a === need) add(S.nba.playoffs.elimination, 'Elimination game');
    else if (sb.h === sb.a) add(S.nba.playoffs.tied, `Series tied ${sb.h}-${sb.a}`);
  }
  if (fam === 'nhl' && sb) {
    const need = sb.toWin - 1;
    if (sb.h === need && sb.a === need) add(S.nhl.playoffs.game7, 'Game 7');
    else if (sb.h === need || sb.a === need) add(S.nhl.playoffs.elimination, 'Elimination game');
  }
  if (fam === 'mlb' && isPostseason(game) && sb) {
    const need = sb.toWin - 1;
    if (sb.h === need && sb.a === need) add(S.mlb.postseason.winnerTakeAll, 'Winner-take-all');
    else if (sb.h === need || sb.a === need) add(S.mlb.postseason.elimination, 'Elimination game');
  }
  if (fam === 'cfb') {
    const hr = game.home?.rank;
    const ar = game.away?.rank;
    if (hr && ar) add(hr <= 10 && ar <= 10 ? S.cfb.rankedTop10 : S.cfb.rankedBoth, hr <= 10 && ar <= 10 ? 'Both ranked in the AP top 10' : `Ranked matchup (No. ${Math.min(hr, ar)} vs No. ${Math.max(hr, ar)})`, 'ranked');
    if (/college football playoff|cfp/i.test(notes)) add(S.cfb.stakes.cfp, 'College Football Playoff');
    else if (/championship/i.test(notes) && !/bowl/i.test(notes)) add(S.cfb.stakes.conferenceTitle, 'Conference title game');
  }
  if (fam === 'mcbb' || fam === 'wcbb') {
    const c = S[fam];
    const hr = game.home?.rank;
    const ar = game.away?.rank;
    if (hr && ar && !game.tournament) add(hr <= 10 && ar <= 10 ? c.rankedTop10 : c.rankedBoth, hr <= 10 && ar <= 10 ? 'Both ranked in the AP top 10' : `Ranked matchup (No. ${Math.min(hr, ar)} vs No. ${Math.max(hr, ar)})`, 'ranked');
    if (game.tournament) {
      const n = notes;
      const pts = /national championship|final four/i.test(n) ? c.tournament.elite8
        : /elite (8|eight)/i.test(n) ? c.tournament.elite8
          : /sweet (16|sixteen)/i.test(n) ? c.tournament.sweet16
            : /2nd round|second round/i.test(n) ? c.tournament.second : c.tournament.first;
      add(pts, `NCAA tournament: ${(n.match(/(First Four|1st Round|2nd Round|Sweet 16|Elite 8|Final Four|National Championship)/i) || ['', 'tournament'])[1]}`);
    } else if (/tournament/i.test(notes) && game.seasonType === 3) {
      add(c.raceStakes[0], 'Conference tournament');
    }
  }
  if (fam === 'soccer') {
    const ss = S.soccer;
    const ko = isPostseason(game);
    if (/2nd leg|second leg/i.test(notes) && game.series?.kind === 'aggregate') {
      // Aggregate before this leg (pregameView already removed this leg's goals).
      const ha = game.series.homeAgg;
      const aa = game.series.awayAgg;
      if (ha != null && aa != null) {
        const d = Math.abs(ha - aa);
        if (d <= 1) add(ss.secondLeg.level, d === 0 ? 'Second leg, aggregate level' : 'Second leg, one goal in it');
        else if (d === 2) add(ss.secondLeg.twoGoals, 'Second leg, two-goal cushion');
        else add(ss.secondLeg.threePlus, `Second leg, tie all but over (${Math.max(ha, aa)}-${Math.min(ha, aa)} on aggregate)`);
      }
    } else if (ko) {
      const slug = `${game.seasonSlug || ''} ${notes}`;
      const pts = /final(?!s?\s*(round|stage))/i.test(slug) && !/semi|quarter/i.test(slug) ? ss.knockout.final
        : /semi/i.test(slug) ? 10 : /quarter/i.test(slug) ? 8 : ss.knockout.min;
      add(pts, /final/i.test(slug) && !/semi|quarter/i.test(slug) ? 'Final' : `Knockout${/semi/i.test(slug) ? ': semifinal' : /quarter/i.test(slug) ? ': quarterfinal' : ''}`);
    }
  }
  return out;
}

// ---------------- narrative ----------------

function narrativeTerms(game, ctx) {
  const fam = family(game.league);
  const out = [];
  const N = CFG.narrative;
  if (isRivalry(game)) {
    const pts = fam === 'soccer' ? S.soccer.derby : fam === 'cfb' ? S.cfb.rivalry : fam === 'nhl' ? S.nhl.rivalry : N.rivalry;
    out.push({ key: 'rivalry', group: 'narrative', points: pts, text: fam === 'soccer' ? 'Derby' : 'Rivalry' });
  }
  if (fam === 'nfl') {
    const hd = ctx.structure?.home?.div;
    if (hd && hd === ctx.structure?.away?.div) out.push({ key: 'division', group: 'narrative', points: S.nfl.division, text: 'Division game' });
    if (game.start && etHour(game.start) >= 19) out.push({ key: 'primetime', group: 'narrative', points: S.nfl.primetime, text: 'Primetime' });
  } else if (['nba', 'nhl', 'mlb'].includes(fam) && nationalTv(game)) {
    out.push({ key: 'nationalTv', group: 'narrative', points: N.nationalTv, text: 'National TV' });
  }
  return out;
}

// ---------------- style / availability / matchup / weather ----------------

function styleTerm(game, ctx) {
  if (family(game.league) !== 'nba' || !ctx.style) return null;
  const [lo, hi] = S.nba.styleRange;
  const z = ((ctx.style.home ?? 0) + (ctx.style.away ?? 0)) / 2;
  const pts = Math.round(Math.max(lo, Math.min(hi, z * 2)) * 10) / 10;
  if (!pts) return null;
  return { key: 'style', group: 'style', points: pts, text: pts > 0 ? 'Two up-tempo teams' : 'Two slow-paced teams' };
}

function availabilityTerms(game, ctx, hasLine) {
  const x = ctx.extras || {};
  const fam = family(game.league);
  const out = [];
  const mult = hasLine ? CFG.availability.lineDiscount : 1;
  if (fam === 'nfl' && x.qbOut) {
    for (const side of ['home', 'away']) {
      if (x.qbOut[side]) out.push({ key: 'availability', group: 'availability', points: S.nfl.qbOut * mult, text: `${game[side]?.short} starting QB out${x.qbOut[side] === true ? '' : ` (${x.qbOut[side]})`}` });
    }
  }
  if (['nba', 'mcbb', 'wcbb'].includes(fam) && x.starOut) {
    for (const side of ['home', 'away']) {
      const who = x.starOut[side];
      if (who) out.push({ key: 'availability', group: 'availability', points: S.nba.starOut[0] * mult, text: `${who} out` });
    }
  }
  if (fam === 'mlb') {
    if (x.aces) out.push({ key: 'aces', group: 'matchup', points: S.mlb.aces, text: `Aces on the mound (${x.aces})` });
    if (x.bullpen) out.push({ key: 'bullpen', group: 'matchup', points: S.mlb.bullpenGame, text: 'Bullpen game' });
  }
  if (fam === 'nhl' && x.goalie) {
    for (const side of ['home', 'away']) {
      if (x.goalie[side] === 'backup') out.push({ key: 'goalie', group: 'matchup', points: -S.nhl.goalie * mult, text: `${game[side]?.short} backup goalie` });
    }
  }
  const tot = out.filter((t) => t.group === 'availability').reduce((s, t) => s + t.points, 0);
  if (tot < CFG.availability.min) {
    const f = CFG.availability.min / tot;
    for (const t of out) if (t.group === 'availability') t.points *= f;
  }
  return out;
}

// ---------------- F1 ----------------

export function circuitAverage(name) {
  const c = String(name || '');
  for (const [k, v] of Object.entries(CFG.f1Circuits)) {
    if (k !== '_doc' && c.toLowerCase().includes(k.toLowerCase())) return v;
  }
  return S.f1.circuitAverageDefault;
}

function f1Terms(game, ctx) {
  const F = S.f1;
  const x = ctx.extras || {};
  const out = [];
  const circuit = `${game.circuit || ''} ${game.gpName || ''}`;
  const override = Object.entries(F.circuitOverride).find(([k]) => circuit.includes(k));
  const avg = circuitAverage(circuit);
  const cpts = override ? override[1] : Math.max(-F.circuitClip, Math.min(F.circuitClip, (avg - F.circuitAverageDefault) * F.circuitScale));
  const name = (game.circuit || game.gpName || 'Circuit').replace(/International Circuit|Grand Prix Circuit|Circuit/g, '').trim();
  out.push({
    key: 'circuit', group: 'quality', points: Math.round(cpts * 10) / 10,
    text: cpts >= 2 ? `${name} (fans' top-rated circuit)` : cpts <= -4 ? `${name}: rarely produces passing` : `${name} (average racing)`,
  });
  if (x.rainProb != null) {
    const r = step(F.rain.map(([lim, p]) => [-lim, p]).concat([[Infinity, 0]]), -x.rainProb);
    if (r) out.push({ key: 'rain', group: 'weather', points: r, text: `${pct(x.rainProb)} rain chance` });
  }
  if (F.streetCircuits.some((s) => circuit.includes(s))) out.push({ key: 'street', group: 'narrative', points: F.streetCircuit, text: 'Street circuit: safety-car chance' });
  if (x.qualiGap != null && x.qualiGap < F.qualiGapTight.seconds) out.push({ key: 'qualiGap', group: 'matchup', points: F.qualiGapTight.points, text: `Front row split by ${x.qualiGap.toFixed(3)}s` });
  if (x.poleMargin != null && x.poleMargin > F.poleMargin.seconds) out.push({ key: 'poleMargin', group: 'matchup', points: F.poleMargin.points, text: `Pole by ${x.poleMargin.toFixed(3)}s` });
  if (x.contenderBack) out.push({ key: 'contenderBack', group: 'matchup', points: F.contenderBack.points, text: `${x.contenderBack} starts P${x.contenderBackPos || '6+'}` });
  if (x.titleGap != null && x.titleGap <= 26) {
    const pts = x.titleGap <= 10 ? F.titleFight[1] : F.titleFight[0];
    out.push({ key: 'titleFight', group: 'stakes', points: pts, text: `Title fight: ${x.titleGap} points between the top two` });
  }
  return out;
}

/**
 * All terms for a game. Returns { terms, matchup, closeness }.
 * `closeness` = the closeness points (used by the blowout guard).
 */
export function computeTerms(game, ctx = {}) {
  const fam = family(game.league);
  if (fam === 'f1') {
    const terms = f1Terms(game, ctx);
    return { terms, matchup: { source: 'none' }, closeness: terms.find((t) => t.key === 'circuit')?.points ?? 0 };
  }
  const m = matchup(game, ctx);
  const terms = [
    ...closenessTerms(game, ctx, m),
    qualityTerm(game, ctx),
    importanceTerm(game, ctx),
    ...stakesTerms(game, ctx),
    styleTerm(game, ctx),
    ...narrativeTerms(game, ctx),
    ...availabilityTerms(game, ctx, m.source === 'market'),
  ].filter(Boolean);
  // Narrative is capped in total.
  const nar = terms.filter((t) => t.group === 'narrative');
  const narSum = nar.reduce((s, t) => s + t.points, 0);
  if (narSum > CFG.narrative.cap) for (const t of nar) t.points *= CFG.narrative.cap / narSum;
  return { terms, matchup: m, closeness: terms.find((t) => t.key === 'closeness')?.points ?? 0 };
}

/** Blowout guard: when closeness <= threshold, stakes + narrative combined are capped. */
export function blowoutGuard(terms, closeness) {
  const g = CFG.blowoutGuard;
  if (closeness > g.closenessAtOrBelow) return { terms, applied: false };
  const sn = terms.filter((t) => (t.group === 'stakes' || t.group === 'narrative') && t.points > 0);
  const sum = sn.reduce((s, t) => s + t.points, 0);
  if (sum <= g.stakesNarrativeCap) return { terms, applied: false };
  const f = g.stakesNarrativeCap / sum;
  for (const t of sn) t.points *= f;
  return { terms, applied: true };
}
