// Time helpers. Every user-facing time is shown in America/Los_Angeles.
// Date keys are 'YYYY-MM-DD' strings for a Pacific calendar day.

export const TZ = 'America/Los_Angeles';

const partsFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

/** Pacific wall-clock parts for a Date. */
export function ptParts(date = new Date()) {
  const p = Object.fromEntries(partsFmt.formatToParts(date).map((x) => [x.type, x.value]));
  return { year: +p.year, month: +p.month, day: +p.day, hour: +p.hour, minute: +p.minute };
}

/** 'YYYY-MM-DD' for the Pacific calendar day containing `date`. */
export function ptDateKey(date = new Date()) {
  const p = ptParts(date);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

export function todayKey() {
  return ptDateKey(new Date());
}

/** Shift a date key by whole days (calendar arithmetic, DST-safe). */
export function addDays(key, n) {
  const [y, m, d] = key.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n, 12));
  return dt.toISOString().slice(0, 10);
}

/** ESPN's `dates=` parameter format. */
export function espnDate(key) {
  return key.replaceAll('-', '');
}

export function isValidKey(key) {
  return /^\d{4}-\d{2}-\d{2}$/.test(key || '');
}

const timeFmt = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' });
const dayFmt = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' });
const longDayFmt = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric' });
const stampFmt = new Intl.DateTimeFormat('en-US', { timeZone: TZ, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

/** '4:30 PM' in Pacific time. */
export function formatTime(iso) {
  if (!iso) return '';
  return timeFmt.format(new Date(iso));
}

/** '10:42am' style, for compact "data from" notices. */
export function formatClock(ts) {
  return timeFmt.format(new Date(ts)).replace(' AM', 'am').replace(' PM', 'pm');
}

/** 'Nov 26, 10:42 AM' for "last updated" labels. */
export function formatStamp(ts) {
  return stampFmt.format(new Date(ts));
}

function keyToUtcNoon(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12));
}

/** 'Today' / 'Tomorrow' / 'Yesterday' / 'Wed, Nov 26'. */
export function dayLabel(key, today = todayKey()) {
  if (key === today) return 'Today';
  if (key === addDays(today, 1)) return 'Tomorrow';
  if (key === addDays(today, -1)) return 'Yesterday';
  return dayFmt.format(keyToUtcNoon(key));
}

export function longDayLabel(key) {
  return longDayFmt.format(keyToUtcNoon(key));
}

/** Minutes from now until an ISO time (negative = in the past). */
export function minutesUntil(iso, now = Date.now()) {
  return (new Date(iso).getTime() - now) / 60000;
}

/** Parse 'mm:ss' or 'ss.s' clock strings into seconds. */
export function clockToSeconds(display) {
  if (display == null) return null;
  const s = String(display).trim();
  if (!s) return null;
  if (s.includes(':')) {
    const [m, sec] = s.split(':');
    return (+m || 0) * 60 + (parseFloat(sec) || 0);
  }
  const v = parseFloat(s);
  return Number.isFinite(v) ? v : null;
}
