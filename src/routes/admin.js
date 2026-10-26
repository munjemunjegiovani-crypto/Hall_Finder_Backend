import { Router } from 'express';
import { requireRole, publicUser } from '../auth.js';
import { ENTRY_SELECT, decorateEntry, findConflicts, scanConflicts, notify, notifyEntryChange } from '../services.js';
import { invalidateGraph } from '../routing.js';
import { parseHHMM } from '../time.js';

const clean = (s, max = 200) => String(s ?? '').trim().slice(0, max);

export function adminRoutes(db) {
  const r = Router();
  r.use(requireRole('admin'));

  r.get('/stats', (_req, res) => {
    const n = (sql) => db.prepare(sql).get().n;
    res.json({
      halls: n(`SELECT COUNT(*) AS n FROM halls WHERE kind = 'room'`),
      buildings: n('SELECT COUNT(*) AS n FROM buildings'),
      students: n(`SELECT COUNT(*) AS n FROM users WHERE role = 'student'`),
      teachers: n(`SELECT COUNT(*) AS n FROM users WHERE role = 'teacher'`),
      classesPerWeek: n(`SELECT COUNT(*) AS n FROM timetable WHERE status = 'scheduled'`),
      openIssues: n(`SELECT COUNT(*) AS n FROM issues WHERE status = 'open'`),
      pendingRequests: n(`SELECT COUNT(*) AS n FROM change_requests WHERE status = 'pending'`),
      conflicts: scanConflicts(db).length,
    });
  });

  // ----- Halls -----
  r.patch('/halls/:code', (req, res) => {
    const h = db.prepare('SELECT * FROM halls WHERE code = ?').get(String(req.params.code).toUpperCase());
    if (!h) return res.status(404).json({ error: 'not_found', message: 'Hall not found.' });
    const b = req.body || {};
    const equipment = Array.isArray(b.equipment) ? b.equipment.map((x) => clean(x, 40)).filter(Boolean).slice(0, 12) : JSON.parse(h.equipment);
    db.prepare('UPDATE halls SET name = ?, capacity = ?, description = ?, equipment = ? WHERE id = ?')
      .run(clean(b.name, 80) || h.name, Math.max(0, Number(b.capacity ?? h.capacity) || 0), b.description !== undefined ? clean(b.description, 400) : h.description, JSON.stringify(equipment), h.id);
    invalidateGraph(db);
    res.json({ ok: true });
  });

  // ----- Courses & timetable -----
  r.get('/courses', (_req, res) => {
    res.json({
      courses: db.prepare(`SELECT c.id, c.code, c.title, c.department, c.level, c.class_size AS classSize, c.teacher_id AS teacherId, u.name AS teacherName
                           FROM courses c LEFT JOIN users u ON u.id = c.teacher_id ORDER BY c.department, c.level, c.code`).all(),
      teachers: db.prepare(`SELECT id, name, department FROM users WHERE role = 'teacher' ORDER BY name`).all(),
    });
  });

  r.get('/timetable', (_req, res) => {
    res.json({ entries: db.prepare(`${ENTRY_SELECT} ORDER BY t.day, t.start_min`).all().map(decorateEntry), conflicts: scanConflicts(db) });
  });

  const parseEntry = (b) => {
    const hall = db.prepare('SELECT id FROM halls WHERE code = ?').get(String(b.hallCode || '').toUpperCase());
    const course = db.prepare('SELECT id FROM courses WHERE id = ?').get(Number(b.courseId));
    const day = Number(b.day);
    const startMin = parseHHMM(b.start);
    const endMin = parseHHMM(b.end);
    if (!hall || !course || !(day >= 1 && day <= 7) || startMin === null || endMin === null || endMin <= startMin) return null;
    return { hallId: hall.id, courseId: course.id, day, startMin, endMin, kind: clean(b.kind, 20) || 'Lecture' };
  };

  r.post('/timetable', (req, res) => {
    const e = parseEntry(req.body);
    if (!e) return res.status(400).json({ error: 'invalid', message: 'Please choose a course, hall, day and a valid start and end time.' });
    const conflicts = findConflicts(db, e);
    if (conflicts.length && !req.body.force) return res.status(409).json({ error: 'conflict', message: 'This overlaps with another class.', conflicts });
    const id = Number(db.prepare('INSERT INTO timetable (course_id, hall_id, day, start_min, end_min, kind) VALUES (?,?,?,?,?,?)').run(e.courseId, e.hallId, e.day, e.startMin, e.endMin, e.kind).lastInsertRowid);
    notifyEntryChange(db, id, { title: 'New class added to your timetable', body: 'Open your timetable to see the new session.', type: 'change' });
    res.status(201).json({ ok: true, id });
  });

  r.put('/timetable/:id', (req, res) => {
    const old = db.prepare(`${ENTRY_SELECT} WHERE t.id = ?`).get(Number(req.params.id));
    if (!old) return res.status(404).json({ error: 'not_found', message: 'Timetable entry not found.' });
    const e = parseEntry({ courseId: old.courseId, ...req.body });
    if (!e) return res.status(400).json({ error: 'invalid', message: 'Please check the hall, day and times.' });
    const conflicts = findConflicts(db, { ...e, ignoreId: old.id });
    if (conflicts.length && !req.body.force) return res.status(409).json({ error: 'conflict', message: 'This overlaps with another class.', conflicts });
    db.prepare('UPDATE timetable SET hall_id = ?, day = ?, start_min = ?, end_min = ?, kind = ? WHERE id = ?').run(e.hallId, e.day, e.startMin, e.endMin, e.kind, old.id);
    if (e.hallId !== old.hallId) {
      const nh = db.prepare('SELECT name, code FROM halls WHERE id = ?').get(e.hallId);
      notifyEntryChange(db, old.id, { title: `Hall change: ${old.courseTitle}`, body: `${old.courseCode} moved from ${old.hallCode} to ${nh.name} (${nh.code}).`, type: 'change' });
    } else if (e.startMin !== old.startMin || e.day !== old.day) {
      notifyEntryChange(db, old.id, { title: `Time change: ${old.courseTitle}`, body: `${old.courseCode} now runs at the updated time. Check your timetable.`, type: 'change' });
    }
    res.json({ ok: true });
  });

  r.post('/timetable/:id/cancel', (req, res) => {
    const old = db.prepare(`${ENTRY_SELECT} WHERE t.id = ?`).get(Number(req.params.id));
    if (!old) return res.status(404).json({ error: 'not_found', message: 'Timetable entry not found.' });
    const cancel = req.body.cancelled !== false;
    db.prepare('UPDATE timetable SET status = ?, note = ? WHERE id = ?').run(cancel ? 'cancelled' : 'scheduled', clean(req.body.note, 200) || null, old.id);
    notifyEntryChange(db, old.id, {
      title: cancel ? `Class cancelled: ${old.courseTitle}` : `Class restored: ${old.courseTitle}`,
      body: cancel ? `${old.courseCode} (${old.start}–${old.end}) will not hold.` : `${old.courseCode} is back on.`,
      type: cancel ? 'cancelled' : 'change',
    });
    res.json({ ok: true });
  });

  r.delete('/timetable/:id', (req, res) => {
    db.prepare('DELETE FROM timetable WHERE id = ?').run(Number(req.params.id));
    res.json({ ok: true });
  });

  // ----- Users -----
  r.get('/users', (_req, res) => {
    res.json({ users: db.prepare('SELECT * FROM users ORDER BY role, name').all().map(publicUser) });
  });
  r.patch('/users/:id/role', (req, res) => {
    if (!['student', 'teacher', 'admin'].includes(req.body.role)) return res.status(400).json({ error: 'invalid', message: 'Unknown role.' });
    if (Number(req.params.id) === req.user.id) return res.status(400).json({ error: 'invalid', message: 'You cannot change your own role.' });
    db.prepare('UPDATE users SET role = ? WHERE id = ?').run(req.body.role, Number(req.params.id));
    res.json({ ok: true });
  });
  r.delete('/users/:id', (req, res) => {
    if (Number(req.params.id) === req.user.id) return res.status(400).json({ error: 'invalid', message: 'You cannot delete your own account.' });
    db.prepare('DELETE FROM users WHERE id = ?').run(Number(req.params.id));
    res.json({ ok: true });
  });

  // ----- Announcements -----
  r.get('/announcements', (_req, res) => {
    res.json({ announcements: db.prepare('SELECT id, title, body, level, active, created_at AS createdAt FROM announcements ORDER BY id DESC').all() });
  });
  r.post('/announcements', (req, res) => {
    const title = clean(req.body.title, 120);
    if (title.length < 3) return res.status(400).json({ error: 'invalid', message: 'Please write a title.' });
    const level = ['info', 'warning', 'urgent'].includes(req.body.level) ? req.body.level : 'info';
    const id = Number(db.prepare('INSERT INTO announcements (title, body, level) VALUES (?,?,?)').run(title, clean(req.body.body, 500), level).lastInsertRowid);
    notify(db, { audience: 'all', title, body: clean(req.body.body, 500), type: level === 'info' ? 'info' : 'alert' });
    res.status(201).json({ ok: true, id });
  });
  r.delete('/announcements/:id', (req, res) => {
    db.prepare('UPDATE announcements SET active = 0 WHERE id = ?').run(Number(req.params.id));
    res.json({ ok: true });
  });

  // ----- Issues and change requests -----
  r.get('/issues', (_req, res) => {
    res.json({ issues: db.prepare(`SELECT i.id, i.kind, i.details, i.status, i.created_at AS createdAt, h.code AS hallCode, h.name AS hallName, u.name AS reporter
                                   FROM issues i JOIN halls h ON h.id = i.hall_id LEFT JOIN users u ON u.id = i.reporter_id ORDER BY i.status, i.id DESC`).all() });
  });
  r.post('/issues/:id/resolve', (req, res) => {
    db.prepare(`UPDATE issues SET status = 'resolved' WHERE id = ?`).run(Number(req.params.id));
    res.json({ ok: true });
  });

  r.get('/change-requests', (_req, res) => {
    res.json({ requests: db.prepare(`
      SELECT cr.id, cr.status, cr.reason, cr.created_at AS createdAt, cr.timetable_id AS timetableId,
             u.name AS teacherName, c.code AS courseCode, c.title AS courseTitle, t.day, t.start_min AS startMin, t.end_min AS endMin,
             oh.code AS fromHall, nh.code AS toHall, nh.name AS toHallName
      FROM change_requests cr
      JOIN users u ON u.id = cr.teacher_id JOIN timetable t ON t.id = cr.timetable_id JOIN courses c ON c.id = t.course_id
      JOIN halls oh ON oh.id = t.hall_id JOIN halls nh ON nh.id = cr.requested_hall_id
      ORDER BY CASE cr.status WHEN 'pending' THEN 0 ELSE 1 END, cr.id DESC`).all() });
  });
  r.post('/change-requests/:id/decide', (req, res) => {
    const cr = db.prepare('SELECT * FROM change_requests WHERE id = ?').get(Number(req.params.id));
    if (!cr || cr.status !== 'pending') return res.status(404).json({ error: 'not_found', message: 'Request not found or already handled.' });
    const approve = req.body.approve === true;
    if (approve) {
      const t = db.prepare('SELECT t.*, c.department, c.level AS clevel FROM timetable t JOIN courses c ON c.id = t.course_id WHERE t.id = ?').get(cr.timetable_id);
      const conflicts = findConflicts(db, { hallId: cr.requested_hall_id, courseId: t.course_id, day: t.day, startMin: t.start_min, endMin: t.end_min, ignoreId: t.id }).filter((c) => c.type === 'hall');
      if (conflicts.length) return res.status(409).json({ error: 'conflict', message: 'That hall is already booked at this time.', conflicts });
      const oldHall = db.prepare('SELECT code FROM halls WHERE id = ?').get(t.hall_id);
      db.prepare('UPDATE timetable SET hall_id = ? WHERE id = ?').run(cr.requested_hall_id, t.id);
      const nh = db.prepare('SELECT code, name FROM halls WHERE id = ?').get(cr.requested_hall_id);
      notifyEntryChange(db, t.id, { title: 'Hall change approved', body: `Class moved from ${oldHall.code} to ${nh.name} (${nh.code}).`, type: 'change' });
    } else {
      notify(db, { userId: cr.teacher_id, title: 'Hall change request declined', body: 'Your request could not be approved.', type: 'info' });
    }
    db.prepare('UPDATE change_requests SET status = ? WHERE id = ?').run(approve ? 'approved' : 'declined', cr.id);
    res.json({ ok: true });
  });

  r.get('/feedback', (_req, res) => {
    res.json({ feedback: db.prepare(`SELECT f.id, f.message, f.rating, f.created_at AS createdAt, u.name FROM feedback f LEFT JOIN users u ON u.id = f.user_id ORDER BY f.id DESC LIMIT 50`).all() });
  });

  return r;
}
