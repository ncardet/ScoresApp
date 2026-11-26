// F1 race rating. Only the race is rated (practice, qualifying and sprint sessions are not).
// Components (each 0..1 after normalisation):
//   leadChanges  laps on which the leader changed
//   overtakes    on-track passes (OpenF1), scaled by the league 95th percentile
//   finalGap     how close P1 and P2 were over the final 20% of laps (and at the flag)
//   incidents    safety cars, virtual safety cars, red flags
//   stakes       championship: points gap between the top two vs points still available

import RATING from '../../config/rating.js';

const clamp01 = (x) => Math.min(1, Math.max(0, x));

/** Ordered race columns (three-letter codes) in ESPN driver standings. */
function raceColumns(row) {
  return Object.keys(row.stats || {}).filter((k) => /^[A-Z]{3}$/.test(k));
}

/**
 * Championship stakes before race `raceIndex` (0-based within the season).
 * Uses ESPN driver standings, which carry points per race.
 */
export function championshipStakes(standings, raceIndex) {
  const group = standings?.groups?.find((g) => /driver/i.test(g.name)) || standings?.groups?.[0];
  if (!group?.rows?.length) return { value: 0, label: '' };
  const cols = raceColumns(group.rows[0]);
  if (!cols.length) return { value: 0, label: '' };
  const idx = raceIndex == null ? cols.length - 1 : Math.min(raceIndex, cols.length - 1);
  const before = group.rows.map((r) => ({
    name: r.team?.short || r.team?.name,
    pts: cols.slice(0, idx).reduce((s, c) => s + (r.stats[c]?.v || 0), 0),
  })).sort((a, b) => b.pts - a.pts);
  const [p1, p2] = before;
  if (!p1 || !p2) return { value: 0, label: '' };
  const gap = p1.pts - p2.pts;
  const remaining = cols.length - idx; // including this race
  const available = 26 * remaining;
  const progress = idx / cols.length;
  const live = clamp01(1 - gap / Math.max(available, 1));
  const value = clamp01(live * Math.pow(progress, 0.6) * (remaining === 1 ? 1.25 : 1));
  let label = '';
  if (remaining === 1 && gap <= 26) label = `Title decider: ${p1.name} leads ${p2.name} by ${gap}`;
  else if (value >= 0.5) label = `Title fight: ${gap} points between ${p1.name} and ${p2.name}`;
  return { value, label, gap, remaining };
}

/** Raw F1 measurements from an F1 GameDetail (see adapters/f1.js). */
export function measureF1(detail) {
  const f1 = detail.f1 || {};
  const laps = f1.laps || [];
  const cfg = RATING.f1;
  let leadChanges = 0;
  for (let i = 2; i < laps.length; i++) {
    if (laps[i].order[0] !== laps[i - 1].order[0]) leadChanges++;
  }
  let overtakes = f1.overtakes;
  if (overtakes == null && laps.length) {
    overtakes = 0;
    for (let i = 2; i < laps.length; i++) {
      const prev = new Map(laps[i - 1].order.map((d, k) => [d, k]));
      laps[i].order.forEach((d, k) => {
        if (!laps[i].pits.includes(d) && prev.has(d) && k < prev.get(d)) overtakes += prev.get(d) - k;
      });
    }
  }
  const n = laps.length;
  const tail = laps.slice(Math.floor(n * 0.8)).filter((l) => l.gap12 != null);
  const closeShare = tail.length ? tail.filter((l) => l.gap12 < cfg.closeGapSeconds).length / tail.length : 0;
  const finishGap = f1.classification?.[1]?.gap ?? laps.at(-1)?.gap12 ?? null;
  const finalGap = clamp01(0.7 * closeShare + 0.3 * (finishGap == null ? 0 : clamp01(1 - finishGap / 5)));
  const c = f1.control || { safetyCars: 0, vsc: 0, redFlags: 0 };
  const incidents = clamp01((c.safetyCars + 0.5 * c.vsc + 1.5 * c.redFlags) / 3);
  const st = championshipStakes(f1.standings, f1.raceIndex);
  return {
    raw: { leadChanges, overtakes: overtakes || 0, finalGap, incidents, stakes: st.value },
    facts: { leadChanges, overtakes, closeShare, finishGap, control: c, stakes: st, laps: n },
  };
}

export function f1Reasons(m, norm) {
  const out = [];
  const f = m.facts;
  const add = (text, tone, score) => out.push({ text, tone, score });
  if (f.stakes?.label) add(f.stakes.label, '+', 0.4 + norm.stakes * 0.2);
  if (f.finishGap != null && f.finishGap < 1) add(`Won by ${f.finishGap.toFixed(3)}s`, '+', 0.5);
  else if (norm.finalGap >= 0.6) add('Close fight for the win late on', '+', 0.35);
  else if (norm.finalGap <= 0.1 && f.finishGap != null) add(`Winner clear by ${f.finishGap.toFixed(1)}s`, '-', 0.3);
  if (f.leadChanges >= 2) add(`${f.leadChanges} lead changes`, '+', 0.3 + norm.leadChanges * 0.2);
  else if (f.leadChanges === 0 && f.laps) add('Same leader every lap', '-', 0.25);
  if (f.overtakes != null) add(`${f.overtakes} overtakes`, norm.overtakes >= 0.4 ? '+' : '-', 0.2 + Math.abs(norm.overtakes - 0.4) * 0.3);
  const c = f.control || {};
  const bits = [];
  if (c.redFlags) bits.push(`${c.redFlags} red flag${c.redFlags > 1 ? 's' : ''}`);
  if (c.safetyCars) bits.push(`${c.safetyCars} safety car${c.safetyCars > 1 ? 's' : ''}`);
  if (c.vsc) bits.push(`${c.vsc} VSC`);
  if (bits.length) add(bits.join(', '), '+', 0.2 + norm.incidents * 0.2);
  return out;
}

/** Number of races already held, from the standings' per-race columns. */
export function completedRaces(standings) {
  const group = standings?.groups?.find((g) => /driver/i.test(g.name)) || standings?.groups?.[0];
  if (!group?.rows?.length) return null;
  const cols = raceColumns(group.rows[0]);
  return cols.filter((c) => group.rows.some((r) => (r.stats[c]?.v || 0) > 0)).length;
}

/** Pre-race prior raw score for the race. */
export function f1PriorRaw(game, standings, raceIndex) {
  const st = championshipStakes(standings, raceIndex);
  const circuit = `${game.circuit || ''} ${game.gpName || ''}`;
  const { up, down } = RATING.f1.overtakingCircuits;
  let track = 0.5;
  if (up.some((c) => circuit.includes(c))) track = 0.75;
  if (down.some((c) => circuit.includes(c))) track = 0.2;
  const raw = 0.55 * st.value + 0.45 * track;
  const reasons = [];
  if (st.label) reasons.push({ text: st.label, tone: '+', score: 0.5 });
  if (track >= 0.75) reasons.push({ text: 'Overtaking-friendly circuit', tone: '+', score: 0.3 });
  if (track <= 0.2) reasons.push({ text: 'Hard circuit to pass on', tone: '-', score: 0.3 });
  return { raw, reasons, stakes: st };
}
