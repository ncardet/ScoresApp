// Game page: header, rating + explanation, excitement curve, win probability, then sport-specific
// detail (linescore, scoring, box score, play-by-play; soccer lineups / xG / momentum; F1 race).
// Sections with no data are not rendered.

import { h, clear, fill, logo, teamLogo } from './dom.js';
import { badge, openRatingSheet, statusInfo, watchInfo, backButton } from './components.js';
import { excitementChart, wpChart, momentumBuckets, momentumChart, periodTicks } from './chart.js';
import { findGame, loadDetail, ratingForGame, getDay } from '../app/store.js';
import { LEAGUE_BY_KEY } from '../core/leagues.js';
import { formatTime, longDayLabel, ptDateKey, formatClock } from '../core/time.js';
import { favoriteFor } from '../core/settings.js';

const REFRESH_MS = 45 * 1000;

// ---------- colours ----------

function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function luminance(rgb) {
  const [r, g, b] = rgb.map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function dist(a, b) {
  return Math.sqrt(a.reduce((s, v, i) => s + (v - b[i]) ** 2, 0));
}
/** Team colours that read on the current theme and differ from each other. */
export function teamColors(home, away) {
  const dark = matchMedia('(prefers-color-scheme: dark)').matches;
  const pick = (t, fallback) => {
    const opts = [t?.color, t?.altColor].map((c) => (c ? `#${c}` : null)).filter(Boolean);
    for (const c of opts) {
      const rgb = hexToRgb(c);
      const L = luminance(rgb);
      if ((dark && L > 0.05) || (!dark && L < 0.75)) return c;
    }
    return fallback;
  };
  const hc = pick(home, '#0a84ff');
  let ac = pick(away, '#ff9500');
  const a = hexToRgb(hc);
  const b = hexToRgb(ac);
  if (a && b && dist(a, b) < 90) {
    const alt = away?.altColor ? `#${away.altColor}` : null;
    ac = alt && hexToRgb(alt) && dist(hexToRgb(alt), a) >= 90 ? alt : (dark ? '#d1d1d6' : '#636366');
  }
  return { home: hc, away: ac };
}

// ---------- small builders ----------

const block = (title, body, meta) => (body ? h('section', { class: 'block' },
  h('h3', { class: 'block-h' }, title, meta ? h('span', { class: 'meta' }, meta) : null),
  body) : null);

function num(v) {
  const n = parseFloat(String(v).replace('%', ''));
  return Number.isFinite(n) ? n : null;
}

function statRows(rows, colors, { homeFirst = false } = {}) {
  if (!rows?.length) return null;
  const c = homeFirst ? { away: colors.home, home: colors.away } : colors;
  return h('div', { class: 'card pad stat-rows' }, rows.map((row) => {
    const r = homeFirst ? { ...row, away: row.home, home: row.away } : row;
    const a = num(r.away);
    const b = num(r.home);
    const total = a != null && b != null && a + b > 0 ? a + b : null;
    return h('div', null,
      h('div', { class: 'stat-row' },
        h('span', { class: 'v' }, r.away),
        h('span', { class: 'mid' }, r.label),
        h('span', { class: 'v r' }, r.home)),
      total ? h('div', { class: 'stat-bars' },
        h('i', null, h('b', { style: { width: `${(a / total) * 100}%`, background: c.away } })),
        h('i', null, h('b', { style: { width: `${(b / total) * 100}%`, background: c.home } }))) : null);
  }));
}

function table(labels, rows, { first = '' } = {}) {
  return h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl' },
    h('thead', null, h('tr', null, h('th', null, first), labels.map((l) => h('th', null, l)))),
    h('tbody', null, rows.map((r) => h('tr', { class: r.cls || '' }, h('td', { class: 'name' }, r.name), r.cells.map((c) => h('td', null, c)))))));
}

// ---------- hero ----------

function hero(game, colors) {
  const lg = LEAGUE_BY_KEY[game.league];
  const st = statusInfo(game);
  const w = watchInfo(game);
  const notes = (game.notes || []).filter(Boolean)[0];
  const showScore = game.state !== 'pre';
  const teamCol = (t) => h('div', { class: 'hero-team' },
    logo(teamLogo(t), t.name),
    h('div', { class: 'nm' }, t.rank ? `${t.rank} ` : '', t.short || t.name, favoriteFor(game) && String(favoriteFor(game).id) === t.id ? ' ★' : ''),
    t.record ? h('div', { class: 'rec' }, t.record) : null);
  const final = game.state === 'post';
  const [L, R] = game.sport === 'soccer' ? [game.home, game.away] : [game.away, game.home];
  const homeWon = final && (game.home.winner || game.home.score > game.away.score);
  const awayWon = final && (game.away.winner || game.away.score > game.home.score);
  const lc = L === game.home ? colors.home : colors.away;
  const rc = R === game.home ? colors.home : colors.away;
  return h('div', { class: 'card hero', style: { '--home-c': rc, '--away-c': lc } },
    h('div', { class: 'hero-league' }, `${lg.short}${notes ? ` · ${notes}` : ''}`),
    h('div', { class: 'hero-main' },
      teamCol(L),
      showScore ? h('div', { class: 'hero-score' },
        h('span', { class: final && !(L === game.home ? homeWon : awayWon) ? 'dim' : '' }, L.score ?? '–'),
        h('span', { class: 'sep' }, '–'),
        h('span', { class: final && !(R === game.home ? homeWon : awayWon) ? 'dim' : '' }, R.score ?? '–')) : h('div', { class: 'hero-score' }, h('span', { class: 'sep' }, 'vs')),
      teamCol(R)),
    h('div', { class: `hero-status ${st.cls}` }, game.state === 'pre' ? `${longDayLabel(ptDateKey(new Date(game.start)))} · ${formatTime(game.start)} PT` : st.text),
    game.live?.text || game.live?.lastPlay ? h('div', { class: 'hero-sub' }, game.live.text || game.live.lastPlay) : null,
    game.series?.summary ? h('div', { class: 'hero-sub' }, game.series.summary) : null,
    game.venue ? h('div', { class: 'hero-sub' }, game.venue) : null,
    w.status !== 'unknown' ? h('div', { class: 'hero-watch' }, w.status === 'ok'
      ? `Watch: ${w.options.slice(0, 2).map((o) => (o.services.length === 1 && o.services[0] === o.network ? o.network : `${o.network} (${o.services.join(', ')})`)).join(' · ')}`
      : 'Not on your services') : null,
  );
}

function ratingCard(rating, predicted, game) {
  if (!rating) return null;
  const card = h('button', { class: 'card rating-card', type: 'button' },
    badge(rating, { size: 'lg', onTap: () => openRatingSheet(rating, { predicted, title: game.name }) }),
    h('div', null,
      h('div', { class: 'lbl' }, `${rating.band.label}${rating.state === 'predicted' ? ' (predicted)' : rating.state === 'live' ? ' (live)' : ''}`),
      rating.pred ? h('div', { class: 'pred-line' }, `${rating.pred.horizon?.label || 'Prediction'}: likely ${rating.pred.low}–${rating.pred.high} · ${Math.round(rating.pred.pGreat * 100)}% chance of Great`) : null,
      h('div', { class: 'why' }, rating.explain || 'Tap for details'),
      predicted && rating.state !== 'predicted' ? h('div', { class: 'tiny', style: { marginTop: '4px' } }, `Predicted ${predicted.value}${predicted.pred ? ` (likely ${predicted.pred.low}–${predicted.pred.high})` : ''}`) : null));
  card.addEventListener('click', () => openRatingSheet(rating, { predicted, title: game.name }));
  return card;
}

// ---------- team-sport sections ----------

function linescore(game) {
  const lg = LEAGUE_BY_KEY[game.league];
  const a = game.away.linescores || [];
  const b = game.home.linescores || [];
  const n = Math.max(a.length, b.length);
  if (!n || lg.sport === 'soccer') return null;
  const labels = Array.from({ length: n }, (_, i) => {
    if (lg.sport === 'baseball') return String(i + 1);
    if (i < lg.periods) return String(i + 1);
    if (lg.sport === 'hockey') return i === lg.periods ? 'OT' : 'SO';
    return i === lg.periods ? 'OT' : `${i - lg.periods + 1}OT`;
  });
  const extra = lg.sport === 'baseball' ? ['R', 'H', 'E'] : ['T'];
  const cells = (t, ls) => {
    const base = labels.map((_, i) => (ls[i] ?? '–'));
    if (lg.sport === 'baseball') {
      const bb = game.baseball || {};
      const hits = t === game.home ? bb.homeHits : bb.awayHits;
      const errs = t === game.home ? bb.homeErrors : bb.awayErrors;
      return [...base, t.score ?? '', hits ?? '', errs ?? ''];
    }
    return [...base, t.score ?? ''];
  };
  return h('div', { class: 'card pad' }, table([...labels, ...extra], [
    { name: game.away.abbr || game.away.short, cells: cells(game.away, a) },
    { name: game.home.abbr || game.home.short, cells: cells(game.home, b) },
  ]));
}

function scoringSummary(detail) {
  const { game } = detail;
  const sport = detail.sport;
  if (sport === 'basketball') return null; // every basket is a score; play-by-play covers it
  let items = [];
  if (sport === 'soccer') return null;
  items = (detail.plays || []).filter((p) => p.scoring && !p.shootout);
  if (!items.length) return null;
  const abbr = (side) => (side === 'home' ? game.home.abbr : side === 'away' ? game.away.abbr : '');
  return h('div', { class: 'card list' }, items.map((p) => h('div', { class: 'play scoring' },
    h('span', { class: 'clk' }, periodName(game, p), h('br'), p.clock || ''),
    h('span', { class: 'txt' }, abbr(p.side) ? h('b', null, `${abbr(p.side)} `) : null, p.text),
    h('span', { class: 'sc' }, p.hs != null ? `${p.as}–${p.hs}` : ''))));
}

function periodName(game, p) {
  const lg = LEAGUE_BY_KEY[game.league];
  if (lg.sport === 'baseball') return `${p.half === 'bottom' ? 'Bot' : 'Top'} ${p.period}`;
  if (lg.sport === 'soccer') return '';
  if (p.period > lg.periods) return lg.sport === 'hockey' && p.period > lg.periods + 1 && game.seasonType !== 3 ? 'SO' : p.period === lg.periods + 1 ? 'OT' : `${p.period - lg.periods}OT`;
  if (lg.sport === 'hockey') return `P${p.period}`;
  return lg.periods === 2 ? `H${p.period}` : `Q${p.period}`;
}

function boxScore(detail) {
  const box = detail.box;
  if (!box?.length) return null;
  const sides = ['away', 'home'].map((s) => box.find((b) => b.side === s)).filter(Boolean);
  if (!sides.length) return null;
  let current = sides[0].side;
  const body = h('div');
  const seg = h('div', { class: 'seg', role: 'tablist' });
  const draw = () => {
    fill(seg, sides.map((s) => h('button', { type: 'button', 'aria-pressed': String(s.side === current), onclick: () => { current = s.side; draw(); } }, s.abbr || s.side)));
    const team = sides.find((s) => s.side === current);
    fill(body, team.groups.map((g) => {
      const rows = g.rows.filter((r) => !r.dnp && r.stats?.length).map((r) => ({ name: `${r.short}${r.pos ? ` ${r.pos}` : ''}`, cells: r.stats, cls: r.starter ? '' : '' }));
      if (!rows.length) return null;
      if (g.totals?.length && g.totals.some((x) => x !== '')) rows.push({ name: 'Total', cells: g.totals, cls: 'total' });
      return h('div', { style: { marginTop: '10px' } },
        g.title ? h('div', { class: 'tiny', style: { textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 4px 2px' } }, g.title) : null,
        table(g.labels, rows));
    }));
  };
  draw();
  return h('div', { class: 'card pad' }, seg, body);
}

function playByPlay(detail) {
  const plays = (detail.plays || []).filter((p) => p.text);
  if (!plays.length) return null;
  const { game } = detail;
  const list = h('div', { class: 'list plays' });
  const all = [...plays].reverse();
  let limit = 60;
  const draw = () => {
    clear(list);
    let lastPeriod = null;
    for (const p of all.slice(0, limit)) {
      const per = detail.sport === 'soccer' ? (p.period >= 2 ? '2nd half' : '1st half') : periodName(game, p);
      if (per !== lastPeriod) {
        list.append(h('div', { class: 'period-h' }, per || ''));
        lastPeriod = per;
      }
      list.append(h('div', { class: `play${p.scoring || /goal/.test(p.type || '') ? ' scoring' : ''}` },
        h('span', { class: 'clk' }, p.clock || ''),
        h('span', { class: 'txt' }, p.text),
        h('span', { class: 'sc' }, p.hs != null && detail.sport !== 'soccer' ? `${p.as}–${p.hs}` : '')));
    }
    if (all.length > limit) {
      list.append(h('button', { class: 'more-btn', type: 'button', onclick: () => { limit = all.length; draw(); } }, `Show all ${all.length}`));
    }
  };
  draw();
  return h('div', { class: 'card' }, list);
}

// ---------- soccer ----------

const SOCCER_STATS = [
  ['expectedGoals', 'Expected goals (xG)', (v) => v.toFixed(2)],
  ['possessionPct', 'Possession', (v) => `${Math.round(v)}%`],
  ['totalShots', 'Shots', String],
  ['shotsOnTarget', 'Shots on target', String],
  ['bigChanceCreated', 'Big chances', String],
  ['bigChanceMissed', 'Big chances missed', String],
  ['touchesInOppBox', 'Touches in opp. box', String],
  ['accuratePasses', 'Accurate passes', String],
  ['passPct', 'Pass accuracy', (v) => `${Math.round(v <= 1 ? v * 100 : v)}%`],
  ['wonCorners', 'Corners', String],
  ['saves', 'Saves', String],
  ['foulsCommitted', 'Fouls', String],
  ['offsides', 'Offsides', String],
  ['yellowCards', 'Yellow cards', String],
  ['redCards', 'Red cards', String],
];

function soccerStats(detail) {
  const adv = detail.soccer?.advanced;
  if (adv) {
    const rows = [];
    for (const [k, label, fmt] of SOCCER_STATS) {
      const a = adv.away?.[k];
      const b = adv.home?.[k];
      if (a == null || b == null) continue;
      rows.push({ label, away: fmt(+a), home: fmt(+b) });
    }
    if (rows.length) return rows;
  }
  // Fall back to the summary's team stats.
  const keep = new Set(['possessionPct', 'totalShots', 'shotsOnTarget', 'wonCorners', 'foulsCommitted', 'yellowCards', 'redCards', 'saves', 'offsides', 'passPct']);
  const rows = (detail.teamStats || []).filter((r) => keep.has(r.key));
  return rows.length ? rows : null;
}

function soccerEvents(detail) {
  const ke = (detail.soccer?.keyEvents || []).filter((k) => /goal|red-card|yellow-card|penalty/.test(k.type) || k.scoring);
  if (!ke.length) return null;
  const icon = (k) => (k.scoring || /goal/.test(k.type) ? '⚽' : /red/.test(k.type) ? '🟥' : /yellow/.test(k.type) ? '🟨' : '•');
  const who = (k) => k.athlete || k.text.replace(/\(.*$/, '').slice(0, 40);
  return h('div', { class: 'card events' }, ke.map((k) => h('div', { class: 'event' },
    h('span', { class: 'l' }, k.side === 'home' ? [who(k), ' ', h('span', { class: 'ic' }, icon(k))] : ''),
    h('span', { class: 'min' }, k.clock || ''),
    h('span', null, k.side === 'away' ? [h('span', { class: 'ic' }, icon(k)), ' ', who(k)] : ''))));
}

const DEPTH = (pos) => {
  const p = String(pos || '').toUpperCase();
  if (p === 'G' || p === 'GK') return 0;
  if (/^(CD|CB|SW|RB|LB|RWB|LWB|D)/.test(p)) return 1;
  if (/^(DM|CDM)/.test(p)) return 2;
  if (/^(CM|RM|LM|M)/.test(p)) return 3;
  if (/^(AM|CAM)/.test(p)) return 4;
  return 5;
};
const LATERAL = (pos) => {
  const p = String(pos || '').toUpperCase();
  if (/-L$|^L/.test(p)) return -1;
  if (/-R$|^R/.test(p)) return 1;
  return 0;
};

/** Place starters on lines given the formation string ("4-2-3-1"). */
export function formationLayout(starters, formation) {
  const lines = String(formation || '').split('-').map(Number).filter((n) => n > 0);
  const gk = starters.find((p) => DEPTH(p.pos) === 0) || starters[0];
  const outfield = starters.filter((p) => p !== gk).sort((a, b) => DEPTH(a.pos) - DEPTH(b.pos) || a.place - b.place);
  if (!lines.length || lines.reduce((a, b) => a + b, 0) !== outfield.length) {
    // Unknown formation: four even lines.
    const per = Math.ceil(outfield.length / 4) || 1;
    lines.length = 0;
    for (let i = 0; i < outfield.length; i += per) lines.push(Math.min(per, outfield.length - i));
  }
  const rows = [[gk]];
  let i = 0;
  for (const n of lines) {
    const row = outfield.slice(i, i + n).sort((a, b) => LATERAL(a.pos) - LATERAL(b.pos) || a.place - b.place);
    rows.push(row);
    i += n;
  }
  return rows;
}

function pitch(detail, colors) {
  const lu = detail.soccer?.lineups;
  if (!lu?.home?.starters?.length || !lu?.away?.starters?.length) return null;
  const el = h('div', { class: 'pitch' },
    h('div', { class: 'lines' }), h('div', { class: 'half' }), h('div', { class: 'circle' }),
    h('div', { class: 'box top' }), h('div', { class: 'box bot' }));
  const place = (side, rows) => {
    const n = rows.length;
    rows.forEach((row, r) => {
      // Home defends the bottom goal, away the top.
      const depth = n > 1 ? r / (n - 1) : 0;
      const y = side === 'home' ? 94 - depth * 40 : 6 + depth * 40;
      row.forEach((p, k) => {
        let x = ((k + 1) / (row.length + 1)) * 100;
        if (side === 'away') x = 100 - x;
        const ev = `${p.goals ? '⚽'.repeat(Math.min(3, p.goals)) : ''}${p.red ? '🟥' : p.yellow ? '🟨' : ''}${p.subbedOut ? '↓' : ''}`;
        el.append(h('div', { class: 'player', style: { left: `${x}%`, top: `${y}%` } },
          h('span', { class: 'shirt', style: { background: side === 'home' ? colors.home : colors.away } }, p.jersey || ''),
          h('span', { class: 'pn' }, (p.short || p.name).replace(/^.\.\s*/, '')),
          ev ? h('span', { class: 'ev' }, ev) : null));
      });
    });
  };
  place('home', formationLayout(lu.home.starters, lu.home.formation));
  place('away', formationLayout(lu.away.starters, lu.away.formation));
  const subs = (side) => (lu[side].subs || []).filter((p) => p.subbedIn).map((p) => `↑ ${p.short || p.name}`);
  const subList = [...subs('away').map((s) => `${detail.game.away.abbr}: ${s}`), ...subs('home').map((s) => `${detail.game.home.abbr}: ${s}`)];
  return h('div', { class: 'card pad' },
    h('div', { class: 'formation-labels' },
      h('span', null, `${detail.game.home.short} ${lu.home.formation || ''} (bottom)`),
      h('span', null, `${detail.game.away.short} ${lu.away.formation || ''} (top)`)),
    el,
    subList.length ? h('div', { class: 'subs' }, subList.map((s) => h('div', null, s))) : null);
}

// ---------- F1 ----------

function f1Sections(detail, game) {
  const out = [];
  const f1 = detail.f1 || {};
  const cls = f1.classification?.length ? f1.classification : null;
  if (cls) {
    out.push(block('Classification', h('div', { class: 'card pad' }, table(['Team', 'Laps', 'Gap', 'Pts'],
      cls.map((r) => ({
        name: `${r.position ?? '–'}. ${r.name ? r.name.replace(/\b([A-Z])([A-Z]+)\b/g, (m, a, b) => a + b.toLowerCase()) : `#${r.number}`}`,
        cells: [r.team || '', r.laps ?? '', r.dnf ? 'DNF' : r.dns ? 'DNS' : r.dsq ? 'DSQ' : r.position === 1 ? '' : (typeof r.gap === 'number' ? `+${r.gap.toFixed(3)}` : (r.gap || '')), r.points ?? ''],
      }))))));
  } else if (game.drivers?.length && game.state !== 'pre') {
    out.push(block(game.state === 'in' ? 'Running order' : 'Results', h('div', { class: 'card pad' }, table(['Driver'],
      game.drivers.slice(0, 22).map((d, i) => ({ name: `${d.order ?? i + 1}.`, cells: [d.name] }))))));
  }
  if (f1.laps?.length) {
    const leaders = f1.laps.map((l) => l.order[0]);
    const changes = leaders.filter((d, i) => i > 1 && d !== leaders[i - 1]).length;
    const c = f1.control || {};
    const facts = [
      ['Laps', f1.laps.length],
      ['Lead changes', changes],
      ['Overtakes', f1.overtakes ?? '—'],
      ['Safety cars', c.safetyCars ?? 0],
      ['Virtual safety cars', c.vsc ?? 0],
      ['Red flags', c.redFlags ?? 0],
    ];
    out.push(block('Race', h('div', { class: 'card pad stat-rows' }, facts.map(([k, v]) => h('div', { class: 'stat-row', style: { gridTemplateColumns: '1fr auto' } }, h('span', { class: 'mid', style: { textAlign: 'left' } }, k), h('span', { class: 'v r' }, v))))));
    // Leader by lap strip.
    const palette = ['#ff3b30', '#0a84ff', '#ff9500', '#34c759', '#af52de', '#5ac8fa'];
    const ids = [...new Set(leaders)];
    const strip = h('div', { style: { display: 'flex', height: '18px', borderRadius: '6px', overflow: 'hidden' } },
      leaders.map((d) => h('span', { title: f1.drivers?.[d]?.name || `#${d}`, style: { flex: '1', background: f1.drivers?.[d]?.color ? `#${f1.drivers[d].color}` : palette[ids.indexOf(d) % palette.length] } })));
    const legend = h('div', { class: 'legend' }, ids.map((d) => h('span', null, h('i', { style: { background: f1.drivers?.[d]?.color ? `#${f1.drivers[d].color}` : palette[ids.indexOf(d) % palette.length] } }), f1.drivers?.[d]?.acronym || `#${d}`)));
    out.push(block('Leader by lap', h('div', { class: 'card pad' }, strip, legend)));
  }
  const st = f1.standings?.groups?.find((g) => /driver/i.test(g.name));
  if (st?.rows?.length) {
    out.push(block('Championship', h('div', { class: 'card pad' }, table(['Pts'],
      st.rows.slice(0, 8).map((r) => ({ name: `${r.stats.rank?.d || ''}. ${r.team.name}`, cells: [r.stats.championshipPts?.d ?? ''] }))))));
  }
  return out;
}

// ---------- view ----------

export function gameView(root, params) {
  const { league, id } = params;
  const lg = LEAGUE_BY_KEY[league];
  const view = h('div', { class: 'view' });
  fill(root, view);
  let alive = true;
  let timer = null;

  const header = h('header', { class: 'topbar' }, h('div', { class: 'title-row' }, backButton('Today')));
  const body = h('div');
  view.append(header, body);
  if (!lg) {
    body.append(h('div', { class: 'empty' }, h('div', { class: 'big' }, 'Unknown league')));
    return () => {};
  }
  body.append(h('div', { class: 'card', style: { height: '220px', marginTop: '8px' } }));

  async function load(force = false) {
    let found;
    try {
      found = await findGame(league, id, { eventId: params.e });
    } catch (e) {
      if (!alive) return;
      fill(body, h('div', { class: 'empty' }, h('div', { class: 'big' }, "Couldn't reach ESPN"), String(e.message || e)));
      return;
    }
    if (!alive) return;
    if (!found) {
      fill(body, h('div', { class: 'empty' }, h('div', { class: 'big' }, 'Game not found')));
      return;
    }
    let { game } = found;
    const day = found.day || getDay(ptDateKey(new Date(game.start)));
    let detail = found.detail || null;
    try {
      detail = await loadDetail(game, { force });
      if (detail?.game) game = { ...game, ...detail.game, home: { ...game.home, ...detail.game.home }, away: { ...game.away, ...detail.game.away } };
      if (game.sport === 'racing') game = { ...found.game, ...game };
    } catch (e) {
      console.warn('detail failed', e);
    }
    const { predicted, current } = await ratingForGame(game, detail, found.day ? day : null).catch(() => ({ predicted: null, current: null }));
    if (!alive) return;
    render(game, detail, current || predicted, predicted);
    clearTimeout(timer);
    if (game.state === 'in') {
      timer = setTimeout(() => { if (document.visibilityState === 'visible') load(true); else timer = setTimeout(() => load(true), REFRESH_MS); }, REFRESH_MS);
    }
  }

  function render(game, detail, rating, predicted) {
    const lgx = LEAGUE_BY_KEY[game.league];
    const sections = [];
    if (game.sport === 'racing') {
      const st = statusInfo(game);
      const w = watchInfo(game);
      sections.push(h('div', { class: 'card hero' },
        h('div', { class: 'hero-league' }, 'Formula 1'),
        h('div', { style: { textAlign: 'center', marginTop: '10px' } },
          h('div', { style: { font: '800 26px var(--font-display)' } }, game.gpName),
          h('div', { class: 'muted' }, `${game.sessionLabel} · ${game.circuit}`)),
        h('div', { class: `hero-status ${st.cls}` }, game.state === 'pre' ? `${longDayLabel(ptDateKey(new Date(game.start)))} · ${formatTime(game.start)} PT` : st.text),
        w.status !== 'unknown' ? h('div', { class: 'hero-watch' }, w.status === 'ok' ? `Watch: ${w.label}` : 'Not on your services') : null));
      if (game.isRace) sections.push(h('div', { class: 'block' }, ratingCard(rating, predicted, game)));
      else sections.push(h('p', { class: 'muted', style: { margin: '12px 4px' } }, 'Only the race is rated.'));
      sections.push(...f1Sections(detail || {}, game));
    } else {
      const colors = teamColors(game.home, game.away);
      sections.push(hero(game, colors));
      sections.push(h('div', { class: 'block' }, ratingCard(rating, predicted, game)));
      const end = Math.max(1, rating?.progress || 0);
      const ticks = periodTicks(game.league, lgx.sport, lgx.periods, end);
      if (rating?.curve?.length > 2 && game.state !== 'pre') {
        sections.push(block('Excitement', h('div', { class: 'card pad chart' }, excitementChart(rating.curve, { ticks, end }))));
      }
      if (rating?.wp?.length > 2 && game.state !== 'pre') {
        const chart = wpChart(rating.wp, { homeColor: colors.home, awayColor: colors.away, homeLabel: game.home.abbr, awayLabel: game.away.abbr, ticks, end });
        sections.push(block('Win probability', h('div', { class: 'card pad chart' }, chart,
          h('div', { class: 'tiny', style: { marginTop: '4px' } }, rating.source === 'espn' ? 'ESPN win probability' : 'Estimated from score and time remaining'))));
      }
      if (detail) {
        if (lgx.sport === 'soccer') {
          sections.push(block('Key events', soccerEvents(detail)));
          const rows = soccerStats(detail);
          sections.push(block('Match stats', statRows(rows, colors, { homeFirst: true }), detail.soccer?.xg ? `xG ${detail.soccer.xg.home.toFixed(2)} – ${detail.soccer.xg.away.toFixed(2)}` : null));
          const m = momentumBuckets(detail.plays, { end: 90 });
          sections.push(block('Momentum', momentumChart(m, { homeColor: colors.home, awayColor: colors.away, goals: detail.soccer?.goals || [] })
            ? h('div', { class: 'card pad chart' }, momentumChart(m, { homeColor: colors.home, awayColor: colors.away, goals: detail.soccer?.goals || [] }),
              h('div', { class: 'legend' }, h('span', null, h('i', { style: { background: colors.home } }), game.home.short), h('span', null, h('i', { style: { background: colors.away } }), game.away.short), h('span', null, 'Shots, corners and chances per 3 minutes')))
            : null));
          sections.push(block('Lineups', pitch(detail, colors)));
          sections.push(block('Commentary', playByPlay(detail)));
        } else {
          sections.push(block('Linescore', linescore(game)));
          sections.push(block('Scoring', scoringSummary(detail)));
          sections.push(block('Team stats', statRows(detail.teamStats?.slice(0, 18), colors)));
          sections.push(block('Box score', boxScore(detail)));
          sections.push(block('Play-by-play', playByPlay(detail), detail.plays?.length ? `${detail.plays.length} plays` : null));
        }
      }
    }
    if (detail?.stale) sections.unshift(h('div', { class: 'banner' }, `Couldn't reach ESPN; showing data from ${formatClock(detail.fetchedAt)}.`));
    fill(body, sections.filter(Boolean));
  }

  load(false);
  return () => { alive = false; clearTimeout(timer); };
}
