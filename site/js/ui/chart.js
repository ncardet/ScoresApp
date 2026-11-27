// Small dependency-free SVG charts: excitement curve, win probability, soccer momentum.

import { frag } from './dom.js';

const W = 340;

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

/** Period boundaries on the 0..1+ time axis, with labels. */
export function periodTicks(league, sport, periods, end) {
  const ticks = [];
  if (sport === 'soccer') {
    ticks.push({ t: 0.5, label: 'HT' });
    if (end > 1.01) ticks.push({ t: 1, label: '90′' });
    return ticks;
  }
  if (sport === 'baseball') {
    for (let i = 3; i <= 9; i += 3) ticks.push({ t: (i * 6) / 54, label: `${i}` });
    return ticks.filter((x) => x.t < end);
  }
  const n = periods || 4;
  for (let i = 1; i < n; i++) ticks.push({ t: i / n, label: sport === 'hockey' ? `P${i + 1}` : n === 2 ? '2H' : `Q${i + 1}` });
  if (end > 1.01) ticks.push({ t: 1, label: 'OT' });
  return ticks;
}

/**
 * Excitement intensity over the game (0..100): a wasabi-ink line over a 15% wasabi area, with the
 * band thresholds (40 / 65 / 85) as faint dashed lines. `watchFrom` (0..1+), if given, marks where
 * the game gets good, in the accent colour.
 */
export function excitementChart(curve, { ticks = [], end = 1, height = 120, watchFrom = null } = {}) {
  if (!curve?.length) return null;
  const H = height;
  const pad = { l: 6, r: 6, t: 8, b: 16 };
  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;
  const tmax = Math.max(end, curve.at(-1).t, 0.01);
  const x = (t) => pad.l + (t / tmax) * iw;
  const y = (v) => pad.t + ih - (v / 100) * ih;
  const line = curve.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join('');
  const area = `${line}L${x(curve.at(-1).t).toFixed(1)},${y(0)}L${x(curve[0].t).toFixed(1)},${y(0)}Z`;
  const grid = [40, 65, 85].map((v) => `<line class="band-line" x1="${pad.l}" x2="${W - pad.r}" y1="${y(v)}" y2="${y(v)}"/>`).join('');
  const tk = ticks.map((k) => `<line class="axis" x1="${x(k.t)}" x2="${x(k.t)}" y1="${pad.t}" y2="${y(0)}"/><text x="${x(k.t) + 2}" y="${H - 4}">${esc(k.label)}</text>`).join('');
  const mark = watchFrom != null ? `<line class="marker" x1="${x(watchFrom)}" x2="${x(watchFrom)}" y1="${pad.t}" y2="${y(0)}" stroke-width="1.5"/><circle class="marker" cx="${x(watchFrom)}" cy="${pad.t + 2}" r="3"/>` : '';
  return frag(`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Excitement over the course of the game">
    ${grid}${tk}
    <path class="ex-area" d="${area}"/>
    <path class="ex-line" d="${line}"/>
    ${mark}
    <text x="${W - pad.r}" y="${y(85) - 3}" text-anchor="end">Great</text>
  </svg>`);
}

/** Home win probability; area above 50% in home colour, below in away colour. */
export function wpChart(wp, { homeColor = 'var(--team-fallback-home)', awayColor = 'var(--team-fallback-away)', homeLabel = 'Home', awayLabel = 'Away', ticks = [], end = 1, height = 110 } = {}) {
  if (!wp?.length) return null;
  const H = height;
  const pad = { l: 6, r: 30, t: 6, b: 16 };
  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;
  const tmax = Math.max(end, wp.at(-1).t, 0.01);
  const x = (t) => pad.l + (t / tmax) * iw;
  const y = (p) => pad.t + (1 - p) * ih;
  // Step line (probability holds until the next play).
  let d = `M${x(wp[0].t).toFixed(1)},${y(wp[0].wp).toFixed(1)}`;
  for (let i = 1; i < wp.length; i++) d += `L${x(wp[i].t).toFixed(1)},${y(wp[i - 1].wp).toFixed(1)}L${x(wp[i].t).toFixed(1)},${y(wp[i].wp).toFixed(1)}`;
  const mid = y(0.5);
  const close = `L${x(wp.at(-1).t).toFixed(1)},${mid}L${x(wp[0].t).toFixed(1)},${mid}Z`;
  const id = `c${Math.random().toString(36).slice(2, 8)}`;
  const tk = ticks.map((k) => `<line class="axis" x1="${x(k.t)}" x2="${x(k.t)}" y1="${pad.t}" y2="${H - pad.b}"/><text x="${x(k.t) + 2}" y="${H - 4}">${esc(k.label)}</text>`).join('');
  return frag(`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Win probability">
    <defs>
      <clipPath id="${id}a"><rect x="0" y="0" width="${W}" height="${mid}"/></clipPath>
      <clipPath id="${id}b"><rect x="0" y="${mid}" width="${W}" height="${H}"/></clipPath>
    </defs>
    ${tk}
    <line class="axis" x1="${pad.l}" x2="${W - pad.r}" y1="${mid}" y2="${mid}"/>
    <path d="${d}${close}" fill="${homeColor}" opacity="0.28" clip-path="url(#${id}a)"/>
    <path d="${d}${close}" fill="${awayColor}" opacity="0.28" clip-path="url(#${id}b)"/>
    <path d="${d}" fill="none" stroke="var(--text)" stroke-opacity="0.7" stroke-width="1.3"/>
    <text x="${W - pad.r + 4}" y="${pad.t + 9}">${esc(homeLabel)}</text>
    <text x="${W - pad.r + 4}" y="${H - pad.b}">${esc(awayLabel)}</text>
    <text x="${W - pad.r + 4}" y="${mid + 3}">50%</text>
  </svg>`);
}

/**
 * Soccer momentum (FotMob-style) from commentary: attacking events per 3-minute bucket,
 * home above the axis, away below.
 */
export function momentumBuckets(plays, { bucket = 3, end = 90 } = {}) {
  const w = { goal: 6, 'shot-on-target': 3, 'shot-hit-woodwork': 3, 'shot-off-target': 2, 'shot-blocked': 1.5, 'corner-awarded': 1.2, 'penalty---scored': 6, offside: 0.4 };
  const n = Math.max(1, Math.ceil(end / bucket));
  const home = new Array(n).fill(0);
  const away = new Array(n).fill(0);
  for (const p of plays || []) {
    const weight = w[p.type] ?? (/^shot-/.test(p.type) ? 1.5 : /goal/.test(p.type) ? 6 : 0);
    if (!weight || !p.side) continue;
    const minute = Math.min(end - 0.01, p.t * 90);
    const i = Math.max(0, Math.min(n - 1, Math.floor(minute / bucket)));
    (p.side === 'home' ? home : away)[i] += weight;
  }
  return { home, away, bucket };
}

export function momentumChart(m, { homeColor, awayColor, goals = [], height = 110 } = {}) {
  if (!m || (!m.home.some(Boolean) && !m.away.some(Boolean))) return null;
  const H = height;
  const pad = { l: 6, r: 6, t: 8, b: 16 };
  const n = m.home.length;
  const iw = W - pad.l - pad.r;
  const bw = iw / n;
  const mid = pad.t + (H - pad.t - pad.b) / 2;
  const max = Math.max(4, ...m.home, ...m.away);
  const sc = ((H - pad.t - pad.b) / 2) / max;
  let bars = '';
  for (let i = 0; i < n; i++) {
    const xh = pad.l + i * bw + 0.5;
    if (m.home[i]) bars += `<rect x="${xh.toFixed(1)}" y="${(mid - m.home[i] * sc).toFixed(1)}" width="${(bw - 1).toFixed(1)}" height="${(m.home[i] * sc).toFixed(1)}" rx="1" fill="${homeColor}"/>`;
    if (m.away[i]) bars += `<rect x="${xh.toFixed(1)}" y="${mid.toFixed(1)}" width="${(bw - 1).toFixed(1)}" height="${(m.away[i] * sc).toFixed(1)}" rx="1" fill="${awayColor}"/>`;
  }
  const x = (min) => pad.l + (min / (n * m.bucket)) * iw;
  const marks = goals.map((g) => `<text x="${x(Math.min(90, g.t * 90)).toFixed(1)}" y="${g.side === 'home' ? pad.t + 2 : H - pad.b + 2}" text-anchor="middle" font-size="10">⚽</text>`).join('');
  return frag(`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Match momentum">
    <line class="axis" x1="${pad.l}" x2="${W - pad.r}" y1="${mid}" y2="${mid}"/>
    <line class="axis" x1="${x(45)}" x2="${x(45)}" y1="${pad.t}" y2="${H - pad.b}" stroke-dasharray="2 3"/>
    ${bars}${marks}
    <text x="${pad.l}" y="${H - 3}">0′</text><text x="${x(45)}" y="${H - 3}" text-anchor="middle">45′</text><text x="${W - pad.r}" y="${H - 3}" text-anchor="end">90′</text>
  </svg>`);
}
