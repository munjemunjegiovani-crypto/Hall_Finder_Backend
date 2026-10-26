import { Router } from 'express';
import { nowFor, schoolClock } from '../time.js';
import { allHallStatuses, hallStatus, ENTRY_SELECT, decorateEntry } from '../services.js';
import { planRoute, loadGraph } from '../routing.js';
import { BUILDINGS, PLAZA, GATE, FLOOR_W, FLOOR_H, CORRIDOR_Y } from '../campus.js';

const HALL_SELECT = `
  SELECT h.id, h.code, h.name, h.type, h.kind, h.capacity, h.equipment, h.description, h.featured,
         h.x, h.y, h.w, h.h, h.side, h.door_x AS doorX, h.door_y AS doorY,
         b.code AS building, b.name AS buildingName, b.color AS buildingColor,
         f.id AS floorId, f.level, f.label AS floorLabel, f.name AS floorName
  FROM halls h JOIN buildings b ON b.id = h.building_id JOIN floors f ON f.id = h.floor_id`;

export const shapeHall = (h, statusOf) => ({
  ...h,
  featured: !!h.featured,
  equipment: JSON.parse(h.equipment || '[]'),
  ...(statusOf ? { status: statusOf(h.id) } : {}),
});

export function publicRoutes(db) {
  const r = Router();

  r.get('/health', (_req, res) => res.json({ ok: true, school: process.env.SCHOOL_NAME || 'Horizon International College' }));

  // Campus overview: buildings, floors, plaza and gate (for the outdoor map)
  r.get('/campus', (_req, res) => {
    const buildings = db.prepare('SELECT * FROM buildings ORDER BY code').all().map((b) => ({
      ...b,
      floors: db.prepare('SELECT id, level, label, name FROM floors WHERE building_id = ? ORDER BY level').all(b.id),
      plazaPath: BUILDINGS.find((x) => x.code === b.code)?.plazaPath || [],
    }));
    res.json({
      school: process.env.SCHOOL_NAME || 'Horizon International College',
      plaza: PLAZA, gate: GATE, floorSize: { w: FLOOR_W, h: FLOOR_H, corridorY: CORRIDOR_Y },
      buildings,
      hallCount: db.prepare(`SELECT COUNT(*) AS n FROM halls WHERE kind = 'room'`).get().n,
    });
  });

  // Floor plan with live status of every room
  r.get('/floors/:id/map', (req, res) => {
    const floor = db.prepare(`SELECT f.id, f.level, f.label, f.name, b.code AS building, b.name AS buildingName
                              FROM floors f JOIN buildings b ON b.id = f.building_id WHERE f.id = ?`).get(req.params.id);
    if (!floor) return res.status(404).json({ error: 'not_found', message: 'Floor not found.' });
    const statusOf = allHallStatuses(db, nowFor(req));
    const halls = db.prepare(`${HALL_SELECT} WHERE h.floor_id = ? ORDER BY h.code`).all(floor.id).map((h) => shapeHall(h, statusOf));
    const nodes = db.prepare('SELECT id, x, y, kind FROM graph_nodes WHERE floor_id = ?').all(floor.id);
    res.json({ floor, size: { w: FLOOR_W, h: FLOOR_H, corridorY: CORRIDOR_Y }, halls, nodes });
  });

  // Hall list with filters
  r.get('/halls', (req, res) => {
    const { q, type, building, floor, free, all } = req.query;
    const statusOf = allHallStatuses(db, nowFor(req));
    let rows = db.prepare(`${HALL_SELECT} ORDER BY b.code, f.level, h.code`).all();
    if (!all) rows = rows.filter((h) => h.kind === 'room' || h.type === 'restroom');
    if (type) rows = rows.filter((h) => h.type === type);
    if (building) rows = rows.filter((h) => h.building === String(building).toUpperCase());
    if (floor !== undefined && floor !== '') rows = rows.filter((h) => String(h.level) === String(floor));
    if (q) {
      const s = String(q).toLowerCase();
      rows = rows.filter((h) => `${h.code} ${h.name} ${h.buildingName} ${h.type}`.toLowerCase().includes(s));
    }
    let out = rows.map((h) => shapeHall(h, statusOf));
    if (free) out = out.filter((h) => h.status.state === 'free' && ['lecture', 'lab', 'seminar', 'lounge', 'library'].includes(h.type));
    res.json({ halls: out });
  });

  r.get('/halls/:code', (req, res) => {
    const row = db.prepare(`${HALL_SELECT} WHERE h.code = ?`).get(String(req.params.code).toUpperCase());
    if (!row) return res.status(404).json({ error: 'not_found', message: 'We could not find that hall.' });
    const now = nowFor(req);
    const clock = schoolClock(now);
    const hall = { ...shapeHall(row), status: hallStatus(db, row.id, now) };
    const schedule = db.prepare(`${ENTRY_SELECT} WHERE t.hall_id = ? AND t.day = ? ORDER BY t.start_min`).all(row.id, clock.day).map(decorateEntry);
    const week = db.prepare(`${ENTRY_SELECT} WHERE t.hall_id = ? ORDER BY t.day, t.start_min`).all(row.id).map(decorateEntry);
    const issues = db.prepare(`SELECT id, kind, details, created_at AS createdAt FROM issues WHERE hall_id = ? AND status = 'open'`).all(row.id);
    // Demo environment readings, stable per hall so the screen looks alive without real sensors.
    let seed = 0;
    for (const ch of row.code) seed = (seed * 31 + ch.charCodeAt(0)) % 997;
    const sensors = {
      temperatureC: 20 + (seed % 4),
      co2ppm: 380 + (seed % 120),
      wifiMbps: 300 + (seed % 7) * 40,
      noiseDb: 32 + (seed % 14),
      simulated: true,
    };
    res.json({ hall, schedule, week, issues, sensors, clock });
  });

  // Unified search: halls, courses, teachers
  r.get('/search', (req, res) => {
    const q = String(req.query.q || '').trim().toLowerCase();
    if (!q) return res.json({ halls: [], courses: [], teachers: [] });
    const like = `%${q}%`;
    const halls = db.prepare(`${HALL_SELECT} WHERE h.kind = 'room' AND (lower(h.code) LIKE ? OR lower(h.name) LIKE ? OR lower(h.type) LIKE ?) ORDER BY h.code LIMIT 8`).all(like, like, like).map((h) => shapeHall(h));
    const courses = db.prepare(`${ENTRY_SELECT.replace('FROM timetable t', 'FROM timetable t')} WHERE (lower(c.code) LIKE ? OR lower(c.title) LIKE ?) GROUP BY c.id ORDER BY c.code LIMIT 6`).all(like, like).map(decorateEntry);
    const teachers = db.prepare(`SELECT u.id, u.name, u.department FROM users u WHERE u.role = 'teacher' AND lower(u.name) LIKE ? LIMIT 5`).all(like);
    const teacherHalls = teachers.map((t) => ({
      ...t,
      halls: db.prepare(`SELECT DISTINCT h.code, h.name FROM timetable tt JOIN courses c ON c.id = tt.course_id JOIN halls h ON h.id = tt.hall_id WHERE c.teacher_id = ? LIMIT 3`).all(t.id),
    }));
    res.json({ halls, courses, teachers: teacherHalls });
  });

  // Wayfinding
  r.get('/route', (req, res) => {
    const { from, to } = req.query;
    if (!from || !to) return res.status(400).json({ error: 'bad_request', message: 'Both "from" and "to" are required.' });
    const plan = planRoute(db, from, to, { accessible: req.query.accessible === '1' || req.query.accessible === 'true' });
    if (plan.error === 'from_not_found') return res.status(404).json({ error: plan.error, message: 'We could not find your starting point.' });
    if (plan.error === 'to_not_found') return res.status(404).json({ error: plan.error, message: 'We could not find that destination.' });
    if (plan.error) return res.status(422).json({ error: plan.error, message: 'No route is available with these options.' });
    res.json(plan);
  });

  // Places you can start from (QR codes, entrances, gate)
  r.get('/locations', (_req, res) => {
    const g = loadGraph(db);
    const spots = [
      { code: 'GATE', name: 'Main Gate', group: 'Campus' },
      { code: 'PLAZA', name: 'Campus Plaza', group: 'Campus' },
      ...[...g.nodes.values()].filter((n) => n.kind === 'entrance').map((n) => ({ code: `entrance:${n.buildingCode}`, name: `${n.buildingName} entrance`, group: 'Campus' })),
    ];
    res.json({ locations: spots });
  });

  r.get('/announcements', (_req, res) => {
    res.json({ announcements: db.prepare('SELECT id, title, body, level, created_at AS createdAt FROM announcements WHERE active = 1 ORDER BY id DESC LIMIT 10').all() });
  });

  return r;
}
