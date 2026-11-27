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
  // A pit stop reshuffles the order without any racing: the car that pits drops back and every
  // car behind it moves up. So passes and lead changes only count between drivers who did not
  // pit on the lap before, during or after.
  const pitWindow = (i) => new Set([...(laps[i - 1]?.pits || []), ...(laps[i]?.pits || []), ...(laps[i + 1]?.pits || [])]);
  let leadChanges = 0;
  let passes = 0;
  for (let i = 2; i < laps.length; i++) {
    const pits = pitWindow(i);
    const before = laps[i - 1].order;
    const now = laps[i].order;
    if (before[0] !== now[0] && !pits.has(before[0]) && !pits.has(now[0])) leadChanges++;
    const pos = new Map(before.map((d, k) => [d, k]));
    const racing = now.filter((d) => pos.has(d) && !pits.has(d));
    // On-track passes: pairs of racing drivers whose order flipped since the last lap.
    for (let x = 0; x < racing.length; x++) {
      for (let y = x + 1; y < racing.length; y++) if (pos.get(racing[x]) > pos.get(racing[y])) passes++;
    }
  }
  // OpenF1's own "overtakes" feed counts pit-cycle position changes too; use it only without laps.
  const overtakes = laps.length > 2 ? passes : (f1.overtakes ?? 0);
  const n = laps.length;
  const tail = laps.slice(Math.floor(n * 0.8)).filter((l) => l.gap12 != null);
  const closeShare = tail.length ? tail.filter((l) => l.gap12 < cfg.closeGapSeconds).length / tail.length : 0;
  const finishGap = f1.classification?.[1]?.gap ?? laps.at(-1)?.gap12 ?? null;
  const finalGap = clamp01(0.7 * closeShare + 0.3 * (finishGap == null ? 0 : clamp01(1 - finishGap / 5)));
  const c = f1.control || { safetyCars: 0, vsc: 0, redFlags: 0 };
  const incidents = clamp01((c.safetyCars + 0.5 * c.vsc + 1.5 * c.redFlags) / 3);
  // Charge: the most places a podium finisher made up after the opening lap.
  const finishOrder = (f1.classification || []).filter((r) => r.position).sort((a, b) => a.position - b.position).map((r) => r.number);
  const podium = (finishOrder.length ? finishOrder : laps.at(-1)?.order || []).slice(0, 3);
  const opening = laps[0]?.order || [];
  let gained = 0;
  let charger = null;
  podium.forEach((d, p) => {
    const s0 = opening.indexOf(d);
    if (s0 >= 0 && s0 - p > gained) { gained = s0 - p; charger = { driver: d, from: s0 + 1, to: p + 1 }; }
  });
  const charge = clamp01(gained / (cfg.chargeNorm || 10));
  const st = championshipStakes(f1.standings, f1.raceIndex);
  return {
    raw: { leadChanges, overtakes, finalGap, incidents, stakes: st.value, charge },
    facts: { leadChanges, overtakes, closeShare, finishGap, control: c, stakes: st, laps: n, charge: charger },
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
  if (f.charge && f.charge.from - f.charge.to >= 5) add(`P${f.charge.to} from P${f.charge.from} after lap 1`, '+', 0.3 + norm.charge * 0.3);
  if (f.overtakes != null) add(`${f.overtakes} on-track passes`, norm.overtakes >= 0.4 ? '+' : '-', 0.2 + Math.abs(norm.overtakes - 0.4) * 0.3);
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
