// Shared business logic: timetable queries, live hall status, conflict detection, reminders.
import { schoolClock, hhmm, CAMPUS_OPEN, CAMPUS_CLOSE } from './time.js';

export const ENTRY_SELECT = `
  SELECT t.id, t.day, t.start_min AS startMin, t.end_min AS endMin, t.kind, t.status, t.note,
         c.id AS courseId, c.code AS courseCode, c.title AS courseTitle, c.color, c.department, c.level AS courseLevel,
         c.class_size AS classSize, u.id AS teacherId, u.name AS teacherName,
         h.id AS hallId, h.code AS hallCode, h.name AS hallName, h.type AS hallType,
         b.code AS building, b.name AS buildingName, f.level AS floorLevel, f.name AS floorName
  FROM timetable t
  JOIN courses c ON c.id = t.course_id
  JOIN halls h ON h.id = t.hall_id
  JOIN buildings b ON b.id = h.building_id
  JOIN floors f ON f.id = h.floor_id
  LEFT JOIN users u ON u.id = c.teacher_id`;

export function decorateEntry(e) {
  return { ...e, start: hhmm(e.startMin), end: hhmm(e.endMin) };
}

/** Timetable rows that apply to this user. Admins see everything. */
export function entriesForUser(db, user, extraWhere = '', params = []) {
  let where = '1=1';
  const args = [];
  if (user.role === 'student') {
    where = 'c.department = ? AND c.level = ?';
    args.push(user.department, user.level);
  } else if (user.role === 'teacher') {
    where = 'c.teacher_id = ?';
    args.push(user.id);
  }
  if (extraWhere) where += ` AND ${extraWhere}`;
  return db
    .prepare(`${ENTRY_SELECT} WHERE ${where} ORDER BY t.day, t.start_min`)
    .all(...args, ...params)
    .map(decorateEntry);
}

/** Current class and next class for a list of entries (already filtered for the user). */
export function currentAndNext(entries, now) {
  const clock = schoolClock(now);
  const live = entries.filter((e) => e.status !== 'cancelled');
  const current = live.find((e) => e.day === clock.day && e.startMin <= clock.minutes && clock.minutes < e.endMin) || null;
  let next = null;
  let daysAhead = 0;
  for (let d = 0; d < 8 && !next; d++) {
    const day = ((clock.day - 1 + d) % 7) + 1;
    const list = live
      .filter((e) => e.day === day && (d > 0 || e.startMin > clock.minutes))
      .sort((a, b) => a.startMin - b.startMin);
    if (list.length) {
      next = list[0];
      daysAhead = d;
    }
  }
  const minutesUntil = next ? daysAhead * 1440 + (next.startMin - clock.minutes) : null;
  return { current, next, daysAhead, minutesUntil, clock };
}

/** Live occupancy of one hall: free / soon / in_use / locked / closed. */
export function hallStatus(db, hallId, now) {
  const clock = schoolClock(now);
  const rows = db
    .prepare(`SELECT t.start_min AS startMin, t.end_min AS endMin, t.status, c.title AS courseTitle, c.code AS courseCode
              FROM timetable t JOIN courses c ON c.id = t.course_id
              WHERE t.hall_id = ? AND t.day = ? AND t.status = 'scheduled' ORDER BY t.start_min`)
    .all(hallId, clock.day);
  const locked = db.prepare(`SELECT 1 FROM issues WHERE hall_id = ? AND status = 'open' AND kind = 'locked' LIMIT 1`).get(hallId);
  return statusFromRows(rows, clock, !!locked);
}

export function statusFromRows(rows, clock, locked = false) {
  const m = clock.minutes;
  const current = rows.find((r) => r.startMin <= m && m < r.endMin);
  const next = rows.find((r) => r.startMin > m);
  if (locked) return { state: 'locked', label: 'Locked', minutes: null, next: next ? summary(next) : null, current: null };
  if (current) return { state: 'in_use', label: 'In use', minutes: current.endMin - m, until: hhmm(current.endMin), current: summary(current), next: next ? summary(next) : null };
  if (m < CAMPUS_OPEN || m >= CAMPUS_CLOSE) return { state: 'closed', label: 'Closed', minutes: null, current: null, next: next ? summary(next) : null };
  if (next) {
    const wait = next.startMin - m;
    return { state: wait <= 15 ? 'soon' : 'free', label: wait <= 15 ? `Busy in ${wait}m` : `Free ${wait >= 60 ? `${Math.floor(wait / 60)}h ${wait % 60}m` : `${wait}m`}`, minutes: wait, until: hhmm(next.startMin), current: null, next: summary(next) };
  }
  return { state: 'free', label: 'Free all day', minutes: CAMPUS_CLOSE - m, until: hhmm(CAMPUS_CLOSE), current: null, next: null };
}
const summary = (r) => ({ title: r.courseTitle, code: r.courseCode, start: hhmm(r.startMin), end: hhmm(r.endMin) });

/** Bulk statuses for every hall (one query, used by the map and the hall list). */
export function allHallStatuses(db, now) {
  const clock = schoolClock(now);
  const rows = db
    .prepare(`SELECT t.hall_id AS hallId, t.start_min AS startMin, t.end_min AS endMin, c.title AS courseTitle, c.code AS courseCode
              FROM timetable t JOIN courses c ON c.id = t.course_id
              WHERE t.day = ? AND t.status = 'scheduled' ORDER BY t.start_min`)
    .all(clock.day);
  const byHall = new Map();
  for (const r of rows) {
    if (!byHall.has(r.hallId)) byHall.set(r.hallId, []);
    byHall.get(r.hallId).push(r);
  }
  const locked = new Set(db.prepare(`SELECT hall_id AS id FROM issues WHERE status = 'open' AND kind = 'locked'`).all().map((r) => r.id));
  return (hallId) => statusFromRows(byHall.get(hallId) || [], clock, locked.has(hallId));
}

/** Double-booking detection: same hall, same teacher or same class group at overlapping times. */
export function findConflicts(db, { hallId, courseId, day, startMin, endMin, ignoreId = 0 }) {
  const course = db.prepare('SELECT department, level, teacher_id AS teacherId FROM courses WHERE id = ?').get(courseId);
  if (!course) return [];
  const rows = db
    .prepare(`${ENTRY_SELECT} WHERE t.day = ? AND t.status = 'scheduled' AND t.id != ? AND t.start_min < ? AND t.end_min > ?`)
    .all(day, ignoreId, endMin, startMin);
  const out = [];
  for (const r of rows) {
    if (r.hallId === Number(hallId)) out.push({ type: 'hall', message: `${r.hallName} is already booked for ${r.courseCode} (${hhmm(r.startMin)}–${hhmm(r.endMin)})`, entry: decorateEntry(r) });
    if (course.teacherId && r.teacherId === course.teacherId) out.push({ type: 'teacher', message: `${r.teacherName} already teaches ${r.courseCode} at ${hhmm(r.startMin)}–${hhmm(r.endMin)}`, entry: decorateEntry(r) });
    if (r.department === course.department && r.courseLevel === course.level) out.push({ type: 'group', message: `${course.department} Level ${course.level} already has ${r.courseCode} at ${hhmm(r.startMin)}–${hhmm(r.endMin)}`, entry: decorateEntry(r) });
  }
  return out;
}

/** Scans the whole timetable for existing conflicts (used by the admin dashboard). */
export function scanConflicts(db) {
  const all = db.prepare(`${ENTRY_SELECT} WHERE t.status = 'scheduled' ORDER BY t.day, t.start_min`).all();
  const found = [];
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      const a = all[i];
      const b = all[j];
      if (a.day !== b.day || !(a.startMin < b.endMin && b.startMin < a.endMin)) continue;
      const types = [];
      if (a.hallId === b.hallId) types.push('hall');
      if (a.teacherId && a.teacherId === b.teacherId) types.push('teacher');
      if (a.department === b.department && a.courseLevel === b.courseLevel) types.push('group');
      for (const type of types) found.push({ type, a: decorateEntry(a), b: decorateEntry(b) });
    }
  }
  return found;
}

/** Reminder cards for the next classes starting within the user's reminder window. */
export function remindersFor(db, user, now) {
  if (user.role === 'admin') return [];
  const entries = entriesForUser(db, user);
  const { current, next, minutesUntil, daysAhead, clock } = currentAndNext(entries, now);
  const out = [];
  if (next && daysAhead === 0 && minutesUntil <= user.reminder_minutes) {
    out.push({
      id: `rem-${next.id}-${clock.date}`,
      type: 'reminder',
      title: `${next.courseCode} starts in ${minutesUntil} min`,
      body: `${next.courseTitle} · ${next.hallName} (${next.hallCode}), ${next.buildingName} ${next.floorName}`,
      hallCode: next.hallCode,
      minutes: minutesUntil,
      entry: next,
    });
  }
  if (current) {
    out.push({
      id: `now-${current.id}-${clock.date}`,
      type: 'now',
      title: `${current.courseCode} is in progress`,
      body: `${current.hallName} · ends at ${current.end}`,
      hallCode: current.hallCode,
      minutes: 0,
      entry: current,
    });
  }
  return out;
}

export function notify(db, { userId = null, audience = null, title, body = '', type = 'info', hallCode = null }) {
  db.prepare('INSERT INTO notifications (user_id, audience, title, body, type, hall_code) VALUES (?,?,?,?,?,?)')
    .run(userId, audience, title, body, type, hallCode);
}

/** Notify every student of a class group and the teacher when their timetable entry changes. */
export function notifyEntryChange(db, entryId, { title, body, type = 'change' }) {
  const e = db.prepare(`${ENTRY_SELECT} WHERE t.id = ?`).get(entryId);
  if (!e) return;
  const students = db.prepare(`SELECT id FROM users WHERE role = 'student' AND department = ? AND level = ?`).all(e.department, e.courseLevel);
  for (const s of students) notify(db, { userId: s.id, title, body, type, hallCode: e.hallCode });
  if (e.teacherId) notify(db, { userId: e.teacherId, title, body, type, hallCode: e.hallCode });
}
