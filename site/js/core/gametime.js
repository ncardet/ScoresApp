// Common game-time axis used by adapters and the rating engine:
// t = 0 at the start, 1 at the end of regulation, > 1 in overtime / extra innings / extra time.

import { clockToSeconds } from './time.js';

/** Fraction of regulation elapsed for a clock-based sport. `clockMode`: 'remaining' | 'elapsed'. */
export function clockT(lg, period, clockDisplay, { clockMode = 'remaining', otMinutes } = {}) {
  const reg = lg.periods * lg.periodMinutes * 60;
  const ot = (otMinutes ?? lg.otMinutes ?? 5) * 60;
  const p = Math.max(1, period || 1);
  const len = p <= lg.periods ? lg.periodMinutes * 60 : ot;
  const before = p <= lg.periods
    ? (p - 1) * lg.periodMinutes * 60
    : reg + (p - lg.periods - 1) * ot;
  const c = clockToSeconds(clockDisplay);
  let inPeriod;
  if (c == null) inPeriod = 0;
  else inPeriod = clockMode === 'remaining' ? len - Math.min(c, len) : Math.min(c, len);
  return (before + Math.max(0, inPeriod)) / reg;
}

/** Soccer: ESPN pins stoppage time to 45:00 / 90:00 on the play clock, which keeps t monotonic. */
export function soccerT(period, clockSec) {
  const s = Math.max(0, clockSec || 0);
  switch (period) {
    case 1: return Math.min(s, 2700) / 5400;
    case 2: return 0.5 + Math.min(Math.max(s - 2700, 0), 2700) / 5400;
    case 3: return 1 + Math.min(Math.max(s - 5400, 0), 900) / 5400;
    case 4: return 1 + (900 + Math.min(Math.max(s - 6300, 0), 900)) / 5400;
    default: return period >= 5 ? 1 + 1800 / 5400 + 0.01 : Math.min(s, 5400) / 5400;
  }
}

/**
 * Soccer from the displayed minute ("23'", "45'+4'", "90'+6'", "105'"). Stoppage time is pinned
 * to the end of its half, so first-half stoppage never overlaps the second half. Returns null
 * when the display has no minute (kick-off / full-time rows).
 */
export function soccerMinuteT(display) {
  const m = String(display || '').match(/^(\d+)'?(?:\s*\+\s*(\d+))?/);
  if (!m) return null;
  const base = +m[1];
  if (base <= 90) return base / 90;
  if (base <= 120) return 1 + (base - 90) / 90;
  return 1 + 30 / 90;
}

/** Baseball: progress in outs. 54 outs (27 per side) = regulation. */
export function baseballT(inning, half, outs) {
  const h = (Math.max(1, inning) - 1) * 2 + (half === 'bottom' ? 1 : 0);
  return (h * 3 + Math.min(3, Math.max(0, outs || 0))) / 54;
}
