import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { signToken, publicUser, requireAuth, requireRole, loginLimiter } from '../auth.js';
import { nowFor, schoolClock } from '../time.js';
import { entriesForUser, currentAndNext, remindersFor, notify, ENTRY_SELECT, decorateEntry } from '../services.js';
import { shapeHall } from './public.js';

const DEPARTMENTS = ['Computer Science', 'Engineering', 'Business'];
const clean = (s, max = 200) => String(s ?? '').trim().slice(0, max);

export function meRoutes(db) {
  const r = Router();

  // ---------- Auth ----------
  r.post('/auth/register', (req, res) => {
    const name = clean(req.body.name, 80);
    const email = clean(req.body.email, 120).toLowerCase();
    const password = String(req.body.password || '');
    const role = req.body.role === 'teacher' ? 'teacher' : 'student';
    const schoolId = clean(req.body.schoolId, 30);
    const department = clean(req.body.department, 60) || (role === 'student' ? DEPARTMENTS[0] : 'General');
    const level = role === 'student' ? Math.min(Math.max(Number(req.body.level) || 1, 1), 4) : null;
    if (name.length < 2) return res.status(400).json({ error: 'invalid', message: 'Please enter your full name.' });
    if (!/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: 'invalid', message: 'Please enter a valid email address.' });
    if (password.length < 6) return res.status(400).json({ error: 'invalid', message: 'Password must be at least 6 characters.' });
    if (!schoolId) return res.status(400).json({ error: 'invalid', message: role === 'student' ? 'Please enter your student ID.' : 'Please enter your staff ID.' });
    if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) return res.status(409).json({ error: 'exists', message: 'An account with this email already exists.' });
    const id = Number(db.prepare(`INSERT INTO users (name,email,password_hash,role,school_id,department,level) VALUES (?,?,?,?,?,?,?)`)
      .run(name, email, bcrypt.hashSync(password, 10), role, schoolId, department, level).lastInsertRowid);
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    res.status(201).json({ token: signToken(user), user: publicUser(user) });
  });

  r.post('/auth/login', loginLimiter, (req, res) => {
    const email = clean(req.body.email, 120).toLowerCase();
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (!user || !bcrypt.compareSync(String(req.body.password || ''), user.password_hash)) {
      return res.status(401).json({ error: 'invalid_credentials', message: 'Incorrect email or password.' });
    }
    res.json({ token: signToken(user), user: publicUser(user) });
  });

  // Demo only: confirms the request without sending real email (no mail provider is configured).
  r.post('/auth/forgot', (_req, res) => {
    res.json({ ok: true, message: 'If this email exists, a reset link has been sent. (Demo mode: no email is actually sent.)' });
  });

  r.get('/me', requireAuth, (req, res) => res.json({ user: publicUser(req.user) }));

  r.patch('/me', requireAuth, (req, res) => {
    const b = req.body || {};
    const u = req.user;
    const next = {
      name: b.name !== undefined ? clean(b.name, 80) || u.name : u.name,
      department: b.department !== undefined ? clean(b.department, 60) || u.department : u.department,
      level: b.level !== undefined && u.role === 'student' ? Math.min(Math.max(Number(b.level) || u.level, 1), 4) : u.level,
      language: ['en', 'fr'].includes(b.language) ? b.language : u.language,
      theme: ['light', 'dark', 'system'].includes(b.theme) ? b.theme : u.theme,
      reminder: [5, 10, 15, 30].includes(Number(b.reminderMinutes)) ? Number(b.reminderMinutes) : u.reminder_minutes,
      push: b.notifyPush !== undefined ? (b.notifyPush ? 1 : 0) : u.notify_push,
      email: b.notifyEmail !== undefined ? (b.notifyEmail ? 1 : 0) : u.notify_email,
      acc: b.accessibleRoutes !== undefined ? (b.accessibleRoutes ? 1 : 0) : u.accessible_routes,
      onboarded: b.onboarded !== undefined ? (b.onboarded ? 1 : 0) : u.onboarded,
    };
    db.prepare(`UPDATE users SET name=?, department=?, level=?, language=?, theme=?, reminder_minutes=?, notify_push=?, notify_email=?, accessible_routes=?, onboarded=? WHERE id=?`)
      .run(next.name, next.department, next.level, next.language, next.theme, next.reminder, next.push, next.email, next.acc, next.onboarded, u.id);
    res.json({ user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(u.id)) });
  });

  // ---------- Timetable ----------
  r.get('/timetable', requireAuth, (req, res) => {
    const entries = entriesForUser(db, req.user);
    const now = nowFor(req);
    const info = currentAndNext(entries, now);
    res.json({ entries, current: info.current, next: info.next, minutesUntil: info.minutesUntil, daysAhead: info.daysAhead, clock: info.clock });
  });

  // Everything the student/teacher dashboard needs in one call
  r.get('/dashboard', requireAuth, (req, res) => {
    const now = nowFor(req);
    const clock = schoolClock(now);
    const entries = entriesForUser(db, req.user);
    const info = currentAndNext(entries, now);
    const today = entries.filter((e) => e.day === clock.day).map((e) => ({
      ...e,
      phase: e.status === 'cancelled' ? 'cancelled' : e.endMin <= clock.minutes ? 'passed' : e.startMin <= clock.minutes ? 'live' : 'upcoming',
      startsInMin: e.startMin - clock.minutes,
    }));
    const stats = req.user.role === 'teacher'
      ? { classesToday: today.length, weeklyClasses: entries.length, halls: new Set(entries.map((e) => e.hallCode)).size }
      : { classesToday: today.length, weeklyClasses: entries.length };
    res.json({
      clock, next: info.next, current: info.current, minutesUntil: info.minutesUntil, daysAhead: info.daysAhead,
      today, stats, reminders: remindersFor(db, req.user, now),
      announcements: db.prepare(`SELECT id, title, body, level FROM announcements WHERE active = 1 ORDER BY id DESC LIMIT 3`).all(),
    });
  });

  // ---------- Favorites & recents ----------
  const hallSelect = `SELECT h.id, h.code, h.name, h.type, h.capacity, b.code AS building, b.name AS buildingName, f.name AS floorName, f.level
                      FROM halls h JOIN buildings b ON b.id=h.building_id JOIN floors f ON f.id=h.floor_id`;
  r.get('/favorites', requireAuth, (req, res) => {
    res.json({ halls: db.prepare(`${hallSelect} JOIN favorites fv ON fv.hall_id = h.id WHERE fv.user_id = ? ORDER BY fv.created_at DESC`).all(req.user.id) });
  });
  r.put('/favorites/:code', requireAuth, (req, res) => {
    const h = db.prepare('SELECT id FROM halls WHERE code = ?').get(String(req.params.code).toUpperCase());
    if (!h) return res.status(404).json({ error: 'not_found', message: 'Hall not found.' });
    db.prepare('INSERT OR IGNORE INTO favorites (user_id, hall_id) VALUES (?,?)').run(req.user.id, h.id);
    res.json({ ok: true, favorite: true });
  });
  r.delete('/favorites/:code', requireAuth, (req, res) => {
    const h = db.prepare('SELECT id FROM halls WHERE code = ?').get(String(req.params.code).toUpperCase());
    if (h) db.prepare('DELETE FROM favorites WHERE user_id = ? AND hall_id = ?').run(req.user.id, h.id);
    res.json({ ok: true, favorite: false });
  });
  r.get('/recents', requireAuth, (req, res) => {
    res.json({ halls: db.prepare(`${hallSelect} JOIN recents rc ON rc.hall_id = h.id WHERE rc.user_id = ? ORDER BY rc.visited_at DESC LIMIT 6`).all(req.user.id) });
  });
  r.post('/recents/:code', requireAuth, (req, res) => {
    const h = db.prepare('SELECT id FROM halls WHERE code = ?').get(String(req.params.code).toUpperCase());
    if (h) db.prepare(`INSERT INTO recents (user_id, hall_id, visited_at) VALUES (?,?,datetime('now'))
                       ON CONFLICT(user_id, hall_id) DO UPDATE SET visited_at = datetime('now')`).run(req.user.id, h.id);
    res.json({ ok: true });
  });

  // ---------- Notifications ----------
  r.get('/notifications', requireAuth, (req, res) => {
    const u = req.user;
    const items = db.prepare(`
      SELECT n.id, n.title, n.body, n.type, n.hall_code AS hallCode, n.created_at AS createdAt,
             CASE WHEN r.user_id IS NULL THEN 0 ELSE 1 END AS read
      FROM notifications n
      LEFT JOIN notification_reads r ON r.notification_id = n.id AND r.user_id = ?
      WHERE n.user_id = ? OR n.audience = 'all' OR n.audience = ?
      ORDER BY n.id DESC LIMIT 50`).all(u.id, u.id, u.role);
    res.json({
      items: items.map((i) => ({ ...i, read: !!i.read })),
      unread: items.filter((i) => !i.read).length,
      reminders: remindersFor(db, u, nowFor(req)),
    });
  });
  r.post('/notifications/read', requireAuth, (req, res) => {
    const rows = db.prepare(`SELECT id FROM notifications WHERE user_id = ? OR audience = 'all' OR audience = ?`).all(req.user.id, req.user.role);
    const ins = db.prepare('INSERT OR IGNORE INTO notification_reads (user_id, notification_id) VALUES (?,?)');
    for (const n of rows) ins.run(req.user.id, n.id);
    res.json({ ok: true });
  });

  // ---------- Teacher tools ----------
  r.post('/issues', requireAuth, (req, res) => {
    const hall = db.prepare('SELECT id, name FROM halls WHERE code = ?').get(String(req.body.hallCode || '').toUpperCase());
    const kind = clean(req.body.kind, 30) || 'other';
    if (!hall) return res.status(404).json({ error: 'not_found', message: 'Choose a hall for this report.' });
    const id = Number(db.prepare('INSERT INTO issues (hall_id, reporter_id, kind, details) VALUES (?,?,?,?)').run(hall.id, req.user.id, kind, clean(req.body.details, 500)).lastInsertRowid);
    res.status(201).json({ ok: true, id });
  });

  r.get('/teacher/attendance', requireRole('teacher'), (req, res) => {
    // Demo numbers: deterministic from the course so the card looks realistic. Replace with real attendance data later.
    const courses = db.prepare('SELECT id, code, title, class_size AS classSize FROM courses WHERE teacher_id = ?').all(req.user.id);
    res.json({
      simulated: true,
      courses: courses.map((c) => {
        const rate = 78 + ((c.id * 7) % 18);
        return { ...c, presentLast: Math.round((c.classSize * rate) / 100), rate };
      }),
    });
  });

  r.post('/change-requests', requireRole('teacher'), (req, res) => {
    const entry = db.prepare(`SELECT t.id FROM timetable t JOIN courses c ON c.id = t.course_id WHERE t.id = ? AND c.teacher_id = ?`).get(Number(req.body.timetableId), req.user.id);
    const hall = db.prepare('SELECT id FROM halls WHERE code = ?').get(String(req.body.hallCode || '').toUpperCase());
    if (!entry || !hall) return res.status(400).json({ error: 'invalid', message: 'Pick one of your classes and the hall you would like.' });
    db.prepare('INSERT INTO change_requests (timetable_id, teacher_id, requested_hall_id, reason) VALUES (?,?,?,?)')
      .run(entry.id, req.user.id, hall.id, clean(req.body.reason, 300));
    const admins = db.prepare(`SELECT id FROM users WHERE role = 'admin'`).all();
    for (const a of admins) notify(db, { userId: a.id, title: 'New hall change request', body: `${req.user.name} asked for ${String(req.body.hallCode).toUpperCase()}.`, type: 'request' });
    res.status(201).json({ ok: true });
  });
  r.get('/change-requests/mine', requireRole('teacher'), (req, res) => {
    res.json({ requests: db.prepare(`SELECT cr.id, cr.status, cr.reason, cr.created_at AS createdAt, h.code AS hallCode, h.name AS hallName, c.code AS courseCode
                                     FROM change_requests cr JOIN halls h ON h.id = cr.requested_hall_id JOIN timetable t ON t.id = cr.timetable_id JOIN courses c ON c.id = t.course_id
                                     WHERE cr.teacher_id = ? ORDER BY cr.id DESC LIMIT 20`).all(req.user.id) });
  });

  r.post('/feedback', (req, res) => {
    const message = clean(req.body.message, 1000);
    if (message.length < 3) return res.status(400).json({ error: 'invalid', message: 'Please write a short message.' });
    db.prepare('INSERT INTO feedback (user_id, message, rating) VALUES (?,?,?)').run(req.user?.id ?? null, message, Number(req.body.rating) || null);
    res.status(201).json({ ok: true });
  });

  return r;
}

export { shapeHall, ENTRY_SELECT, decorateEntry };
