// All timetable maths happens in the school's own time zone, not the server's.
export const SCHOOL_TZ = process.env.SCHOOL_TZ || 'Africa/Douala';

const fmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: SCHOOL_TZ,
  weekday: 'short',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});
const DAY_INDEX = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

/** Returns { day: 1..7 (Mon=1), minutes: minutes since midnight, date: 'YYYY-MM-DD' } in school time. */
export function schoolClock(date = new Date()) {
  const p = Object.fromEntries(fmt.formatToParts(date).map((x) => [x.type, x.value]));
  return {
    day: DAY_INDEX[p.weekday] || 1,
    minutes: Number(p.hour) * 60 + Number(p.minute),
    date: `${p.year}-${p.month}-${p.day}`,
  };
}

/**
 * "Now" for a request. A front end in demo mode sends X-Demo-Now (an ISO time) so the app
 * can be shown on a Sunday night as if it were Monday 10:00.
 */
export function nowFor(req) {
  const demo = req?.headers?.['x-demo-now'];
  if (demo) {
    const d = new Date(String(demo));
    if (!Number.isNaN(d.getTime())) return d;
  }
  return new Date();
}

export const CAMPUS_OPEN = 7 * 60;
export const CAMPUS_CLOSE = 20 * 60;

export function hhmm(min) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
export function parseHHMM(s) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || ''));
  if (!m) return null;
  const v = Number(m[1]) * 60 + Number(m[2]);
  return v >= 0 && v < 24 * 60 ? v : null;
}
