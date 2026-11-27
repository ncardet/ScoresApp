// Standings & brackets: tables for every league, playoff pictures (NFL/NBA/NHL/MLB sorted by
// seed with the cut line), postseason brackets, March Madness, UCL/UEL knockouts, F1 standings.

import { appHeader } from './components.js';
import { h, clear, fill, logo, teamLogo, sportIcon } from './dom.js';
import { LEAGUES, LEAGUE_BY_KEY } from '../core/leagues.js';
import { ADAPTERS } from '../adapters/index.js';
import { postseasonGames, currentWindow } from '../adapters/espn/postseason.js';
import { favoriteTeamIds, getSettings, enabledLeagues } from '../core/settings.js';
import { formatStamp } from '../core/time.js';

const KEY = 'sideline.standingsLeague';
const CUT = { nfl: 7, nba: 6, nhl: 8, mlb: 6 }; // per conference; the WNBA's top 8 are league-wide
const PLAYIN = { nba: 10 };

const s = (row, ...keys) => {
  for (const k of keys) {
    const v = row.stats[k];
    if (v && v.d !== '' && v.d != null) return v.d;
  }
  return '';
};

const COLUMNS = {
  nfl: [['W', 'wins'], ['L', 'losses'], ['T', 'ties'], ['PCT', 'winPercent'], ['PF', 'pointsFor'], ['PA', 'pointsAgainst'], ['DIFF', 'differential', 'pointDifferential'], ['STRK', 'streak']],
  nba: [['W', 'wins'], ['L', 'losses'], ['PCT', 'winPercent'], ['GB', 'gamesBehind'], ['L10', 'Last Ten Games', 't:lasttengames'], ['STRK', 'streak']],
  mlb: [['W', 'wins'], ['L', 'losses'], ['PCT', 'winPercent'], ['GB', 'gamesBehind'], ['STRK', 'streak']],
  nhl: [['GP', 'gamesPlayed'], ['W', 'wins'], ['L', 'losses'], ['OTL', 'otLosses', 'overtimeLosses'], ['PTS', 'points'], ['DIFF', 'differential', 'pointDifferential']],
  college: [['Overall', 't:total', 'overall'], ['PCT', 'winPercent'], ['Conf %', 'leagueWinPercent'], ['STRK', 'streak']],
  soccer: [['GP', 'gamesPlayed'], ['W', 'wins'], ['D', 'ties'], ['L', 'losses'], ['GD', 'pointDifferential'], ['PTS', 'points']],
};

function columnsFor(lg) {
  if (lg.college) return COLUMNS.college;
  if (lg.sport === 'soccer') return COLUMNS.soccer;
  return COLUMNS[lg.key] || COLUMNS.nba;
}

function teamCell(team, extra) {
  return h('div', { class: 'team-cell' }, logo(teamLogo(team), ''), h('span', null, team.short || team.name), extra || null);
}

function standingsTable(lg, group, { seeded = false, favIds }) {
  const cols = columnsFor(lg);
  let rows = [...group.rows];
  if (seeded) rows.sort((a, b) => (a.stats.playoffSeed?.v || 99) - (b.stats.playoffSeed?.v || 99));
  const cut = seeded ? CUT[lg.key] : null;
  const playIn = seeded ? PLAYIN[lg.key] : null;
  const body = rows.map((r, i) => {
    const seed = seeded ? r.stats.playoffSeed?.v || i + 1 : (r.stats.rank?.v || i + 1);
    const clinch = s(r, 'clincher');
    const cls = [
      cut && i + 1 === cut ? 'cut' : '',
      playIn && i + 1 === playIn ? 'cut' : '',
      favIds.has(r.team.id) ? 'fav' : '',
    ].join(' ');
    const noteColor = r.note?.color ? `#${r.note.color.replace('#', '')}` : null;
    return h('tr', { class: cls, title: r.note?.text || '' },
      h('td', { style: noteColor ? { boxShadow: `inset 3px 0 0 ${noteColor}` } : null },
        h('div', { class: 'team-cell' },
          h('span', { class: 'seed' }, seed),
          logo(teamLogo(r.team), ''),
          h('span', null, r.team.short || r.team.name),
          clinch && clinch !== '-' ? h('span', { class: 'clinch' }, clinch) : null)),
      cols.map(([, ...keys]) => h('td', null, s(r, ...keys))));
  });
  return h('div', { class: 'card pad', style: { marginTop: '10px' } },
    h('div', { class: 'block-h', style: { margin: '0 0 6px' } }, group.name,
      seeded && cut ? h('span', { class: 'meta' }, `Top ${cut} make the playoffs${playIn ? ` · 7–${playIn} play-in` : ''}`) : null),
    h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl' },
      h('thead', null, h('tr', null, h('th', null, 'Team'), cols.map(([label]) => h('th', null, label)))),
      h('tbody', null, body))),
    group.rows.some((r) => r.note?.text) ? h('div', { class: 'legend' }, [...new Map(group.rows.filter((r) => r.note?.text).map((r) => [r.note.text, r.note.color])).entries()]
      .map(([text, color]) => h('span', null, h('i', { style: { background: `#${String(color).replace('#', '')}` } }), text))) : null);
}

function f1Tables(st) {
  return st.groups.map((g) => h('div', { class: 'card pad', style: { marginTop: '10px' } },
    h('div', { class: 'block-h', style: { margin: '0 0 6px' } }, g.name),
    h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl' },
      h('thead', null, h('tr', null, h('th', null, /driver/i.test(g.name) ? 'Driver' : 'Constructor'), h('th', null, 'Pts'))),
      h('tbody', null, g.rows.map((r, i) => h('tr', null,
        h('td', null, h('div', { class: 'team-cell' }, h('span', { class: 'seed' }, r.stats.rank?.d || i + 1),
          r.team.logo ? logo(r.team.logo, '') : null, h('span', null, r.team.name))),
        h('td', null, s(r, 'championshipPts', 'points')))))))));
}

// ---------- brackets ----------

function matchCard(teams, sub) {
  return h('div', { class: 'match' }, teams.map((t) => h('div', { class: `mt${t.won ? ' w' : t.lost ? ' l' : ''}` },
    logo(teamLogo(t.team), ''), h('span', null, `${t.seed ? `${t.seed} ` : ''}${t.team.short || t.team.abbr || 'TBD'}`), h('span', null, t.score ?? ''))),
  sub ? h('div', { class: 'sub' }, sub) : null);
}

function roundName(notes) {
  const n = notes.find(Boolean) || '';
  return n.replace(/\s*-\s*Game \d+.*$/i, '').replace(/^NCAA (Men's|Women's) Basketball Championship\s*-\s*/i, '').trim();
}

/** Group series games (NBA/NHL/MLB) into series by matchup. */
function seriesBracket(games) {
  const series = new Map();
  for (const g of games) {
    const pair = [g.home.id, g.away.id].sort().join('-');
    if (!series.has(pair)) series.set(pair, { round: roundName(g.notes), games: [], first: g.start });
    series.get(pair).games.push(g);
  }
  const rounds = new Map();
  for (const sr of series.values()) {
    const last = sr.games.at(-1);
    const wins = {};
    for (const g of sr.games) {
      if (g.state !== 'post') continue;
      const w = g.home.winner ? g.home : g.away.winner ? g.away : null;
      if (w) wins[w.id] = (wins[w.id] || 0) + 1;
    }
    const a = last.home;
    const b = last.away;
    const card = { a, b, wa: wins[a.id] || 0, wb: wins[b.id] || 0, summary: last.series?.summary || '' };
    const key = sr.round || 'Playoffs';
    if (!rounds.has(key)) rounds.set(key, { name: key, first: sr.first, cards: [] });
    rounds.get(key).cards.push(card);
  }
  return [...rounds.values()].sort((x, y) => new Date(x.first) - new Date(y.first));
}

/** Single games by round (NFL playoffs, March Madness). */
function gameBracket(games, roundOf = (g) => roundName(g.notes)) {
  const rounds = new Map();
  for (const g of games) {
    const key = roundOf(g) || 'Round';
    if (!rounds.has(key)) rounds.set(key, { name: key, first: g.start, games: [] });
    rounds.get(key).games.push(g);
  }
  return [...rounds.values()].sort((x, y) => new Date(x.first) - new Date(y.first));
}

/** Two-legged soccer ties. */
function tieBracket(games) {
  const ties = new Map();
  const stage = (g) => {
    const slug = g.seasonSlug || '';
    return slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) || roundName(g.notes);
  };
  for (const g of games) {
    const pair = [g.home.id, g.away.id].sort().join('-');
    const key = `${stage(g)}|${pair}`;
    if (!ties.has(key)) ties.set(key, { stage: stage(g), legs: [], first: g.start });
    ties.get(key).legs.push(g);
  }
  const rounds = new Map();
  for (const t of ties.values()) {
    if (!rounds.has(t.stage)) rounds.set(t.stage, { name: t.stage, first: t.first, ties: [] });
    rounds.get(t.stage).ties.push(t);
  }
  return [...rounds.values()].sort((x, y) => new Date(x.first) - new Date(y.first));
}

function bracketView(lg, games) {
  if (!games.length) return null;
  const won = (g, t) => g.state === 'post' && (t.winner || (t.score > (t === g.home ? g.away.score : g.home.score)));
  let columns;
  if (lg.key === 'nfl' || lg.college) {
    const rounds = gameBracket(games, lg.college ? (g) => {
      const n = g.notes.find((x) => /Round|Sweet|Elite|Final Four|Championship|First Four/i.test(x)) || g.notes[0] || '';
      const m = n.match(/(First Four|1st Round|2nd Round|Sweet 16|Elite 8|Final Four|National Championship)/i);
      return m ? m[1] : roundName(g.notes);
    } : undefined);
    columns = rounds.map((r) => h('div', { class: 'round' }, h('h4', null, r.name),
      r.games.map((g) => matchCard([g.away, g.home].map((t) => ({ team: t, score: g.state === 'pre' ? '' : t.score, won: won(g, t), lost: g.state === 'post' && !won(g, t) })),
        lg.college ? (g.notes[0] || '').replace(/^NCAA (Men's|Women's) Basketball Championship\s*-\s*/i, '').replace(/\s*-\s*[^-]*Round$/i, '') : ''))));
  } else if (lg.sport === 'soccer') {
    columns = tieBracket(games).map((r) => h('div', { class: 'round' }, h('h4', null, r.name),
      r.ties.map((t) => {
        const a = t.legs[0].home;
        const b = t.legs[0].away;
        const agg = { [a.id]: 0, [b.id]: 0 };
        for (const g of t.legs) {
          if (g.state === 'pre') continue;
          agg[g.home.id] = (agg[g.home.id] || 0) + (g.home.score || 0);
          agg[g.away.id] = (agg[g.away.id] || 0) + (g.away.score || 0);
        }
        const done = t.legs.every((g) => g.state === 'post');
        const last = t.legs.at(-1);
        const winner = done ? (last.home.winner ? last.home.id : last.away.winner ? last.away.id : null) : null;
        return matchCard([a, b].map((tm) => ({ team: tm, score: t.legs.some((g) => g.state !== 'pre') ? agg[tm.id] : '', won: winner === tm.id, lost: winner && winner !== tm.id })),
          t.legs.length > 1 ? 'Aggregate' : (last.notes[0] || ''));
      })));
  } else {
    columns = seriesBracket(games).map((r) => h('div', { class: 'round' }, h('h4', null, r.name),
      r.cards.map((c) => matchCard([
        { team: c.b, score: c.wb, won: c.wb > c.wa && /win|won/i.test(c.summary), lost: c.wa > c.wb && /win|won/i.test(c.summary) },
        { team: c.a, score: c.wa, won: c.wa > c.wb && /win|won/i.test(c.summary), lost: c.wb > c.wa && /win|won/i.test(c.summary) },
      ], c.summary))));
  }
  return h('div', { class: 'card pad' }, h('div', { class: 'bracket' }, columns));
}

// ---------- view ----------

export function standingsView(root, params = {}) {
  let key = params.league || (() => { try { return localStorage.getItem(KEY); } catch { return null; } })() || 'nba';
  if (!Object.hasOwn(LEAGUE_BY_KEY, key) || LEAGUE_BY_KEY[key].standings === false) key = 'nba';
  const chips = h('div', { class: 'chips', role: 'toolbar', 'aria-label': 'Leagues' });
  const body = h('div');
  const view = h('div', { class: 'view' },
    appHeader({ title: 'Standings' }), chips,
    body);
  fill(root, view);
  let alive = true;
  let seq = 0;

  function drawChips() {
    fill(chips, enabledLeagues().filter((l) => l.standings !== false).map((l) => h('button', {
      class: 'chip', type: 'button', 'aria-pressed': String(l.key === key),
      onclick: () => { key = l.key; try { localStorage.setItem(KEY, key); } catch { /* ignore */ } drawChips(); load(); },
    }, sportIcon(l.sport), l.short)));
  }

  async function load() {
    const my = ++seq;
    const lg = LEAGUE_BY_KEY[key];
    fill(body, h('div', { class: 'card', style: { height: '320px', marginTop: '12px' } }));
    const favIds = new Set(favoriteTeamIds(key));
    const parts = [];
    try {
      const st = await ADAPTERS[key].standings();
      if (!alive || my !== seq) return;
      if (lg.sport === 'racing') {
        parts.push(...f1Tables(st));
      } else {
        const seeded = !!CUT[key];
        let groups = st.groups;
        if (lg.college) {
          // Favorite's conference first.
          groups = [...groups].sort((a, b) => (b.rows.some((r) => favIds.has(r.team.id)) ? 1 : 0) - (a.rows.some((r) => favIds.has(r.team.id)) ? 1 : 0));
          const select = h('select', { class: 'input', 'aria-label': 'Conference' }, groups.map((g, i) => h('option', { value: String(i) }, g.name)));
          const holder = h('div');
          const show = () => fill(holder, standingsTable(lg, groups[+select.value], { favIds }));
          select.addEventListener('change', show);
          parts.push(h('div', { style: { marginTop: '12px' } }, select), holder);
          show();
        } else {
          parts.push(...groups.map((g) => standingsTable(lg, g, { seeded, favIds })));
        }
      }
      if (st.season) parts.unshift(h('div', { class: 'muted', style: { margin: '12px 4px 0' } }, `${st.season}${st.stale ? ` · offline copy from ${formatStamp(st.at)}` : ''}`));
    } catch (e) {
      parts.push(h('div', { class: 'empty' }, h('div', { class: 'big' }, "Couldn't load standings"), String(e.message || e)));
    }
    fill(body, parts);
    // Brackets (postseason, March Madness, UCL/UEL knockouts) when active or just finished.
    const win = currentWindow(key);
    if (win) {
      const holder = h('section', { class: 'block' }, h('h3', { class: 'block-h' },
        lg.college ? 'NCAA Tournament' : lg.sport === 'soccer' ? 'Knockout rounds' : `${win.year} Postseason`,
        h('span', { class: 'meta' }, win.active ? 'in progress' : 'final')),
      h('div', { class: 'card pad muted' }, 'Loading bracket…'));
      body.prepend(holder);
      try {
        const { games } = await postseasonGames(key);
        if (!alive || my !== seq) return;
        const view2 = bracketView(lg, games);
        if (view2) holder.replaceChild(view2, holder.lastChild); else holder.remove();
      } catch {
        holder.remove();
      }
    }
  }

  drawChips();
  load();
  return () => { alive = false; };
}
