// Fills an empty database with the campus, demo accounts, courses and a full weekly timetable.
// Run automatically on first start, or manually with: npm run seed
import bcrypt from 'bcryptjs';
import { openDb, tx } from './db.js';
import { buildCampus, BUILDINGS } from './campus.js';
import { findConflicts } from './services.js';

export const DEMO_PASSWORD = 'demo1234';

const TEACHERS = [
  { key: 'vance', name: 'Prof. Marcus Vance', email: 'teacher@hallfinder.demo', sid: 'T-1001', dept: 'Computer Science' },
  { key: 'okafor', name: 'Dr. Amina Okafor', email: 'amina.okafor@hallfinder.demo', sid: 'T-1002', dept: 'Mathematics' },
  { key: 'mbarga', name: 'Dr. Sofia Mbarga', email: 'sofia.mbarga@hallfinder.demo', sid: 'T-1003', dept: 'Languages' },
  { key: 'tchoumi', name: 'Prof. Daniel Tchoumi', email: 'daniel.tchoumi@hallfinder.demo', sid: 'T-1004', dept: 'Computer Science' },
  { key: 'fofang', name: 'Dr. Elena Fofang', email: 'elena.fofang@hallfinder.demo', sid: 'T-1005', dept: 'Engineering' },
  { key: 'raman', name: 'Dr. Priya Raman', email: 'priya.raman@hallfinder.demo', sid: 'T-1006', dept: 'Computer Science' },
  { key: 'ndzi', name: 'Mr. Joseph Ndzi', email: 'joseph.ndzi@hallfinder.demo', sid: 'T-1007', dept: 'Business' },
  { key: 'bih', name: 'Ms. Linda Bih', email: 'linda.bih@hallfinder.demo', sid: 'T-1008', dept: 'Engineering' },
  { key: 'ayuk', name: 'Dr. Kevin Ayuk', email: 'kevin.ayuk@hallfinder.demo', sid: 'T-1009', dept: 'Computer Science' },
  { key: 'nkeng', name: 'Mrs. Rita Nkeng', email: 'rita.nkeng@hallfinder.demo', sid: 'T-1010', dept: 'Business' },
];

const STUDENTS = [
  { name: 'Alex Carter', email: 'student@hallfinder.demo', sid: '8821', dept: 'Computer Science', level: 2 },
  { name: 'Grace Tabi', email: 'grace.tabi@hallfinder.demo', sid: '8822', dept: 'Computer Science', level: 2 },
  { name: 'Brian Essomba', email: 'brian.essomba@hallfinder.demo', sid: '8823', dept: 'Computer Science', level: 2 },
  { name: 'Naomi Fon', email: 'naomi.fon@hallfinder.demo', sid: '8824', dept: 'Computer Science', level: 3 },
  { name: 'Samuel Njoya', email: 'samuel.njoya@hallfinder.demo', sid: '8825', dept: 'Computer Science', level: 3 },
  { name: 'Clara Bessong', email: 'clara.bessong@hallfinder.demo', sid: '8826', dept: 'Engineering', level: 2 },
  { name: 'David Mukete', email: 'david.mukete@hallfinder.demo', sid: '8827', dept: 'Engineering', level: 2 },
  { name: 'Esther Ndip', email: 'esther.ndip@hallfinder.demo', sid: '8828', dept: 'Business', level: 1 },
  { name: 'Felix Atanga', email: 'felix.atanga@hallfinder.demo', sid: '8829', dept: 'Business', level: 1 },
  { name: 'Joy Mbah', email: 'joy.mbah@hallfinder.demo', sid: '8830', dept: 'Business', level: 1 },
];

const COLORS = ['#1E3A8A', '#0D9488', '#7C3AED', '#D97706', '#DB2777', '#0891B2', '#4F46E5', '#059669'];

// Each group gets a weekly rota built from these courses. `pref` lists the halls we would like to use first.
const GROUPS = [
  {
    dept: 'Computer Science', level: 2, courses: [
      { code: 'CS302', title: 'Database Management Systems', t: 'vance', kind: 'Lecture', size: 48, pref: ['B204', 'B101'] },
      { code: 'MATH240', title: 'Discrete Mathematics', t: 'okafor', kind: 'Lecture', size: 48, pref: ['A201', 'A101'] },
      { code: 'ENG201', title: 'Technical Writing', t: 'mbarga', kind: 'Lecture', size: 45, pref: ['A102', 'A202'] },
      { code: 'CS310', title: 'Web Development', t: 'tchoumi', kind: 'Lab', size: 40, pref: ['B103', 'B104', 'B202'] },
      { code: 'CS304', title: 'Data Structures & Algorithms', t: 'raman', kind: 'Lecture', size: 48, pref: ['B101', 'B102'] },
      { code: 'CS302L', title: 'Database Lab', t: 'vance', kind: 'Lab', size: 36, pref: ['B202', 'B104'] },
    ],
  },
  {
    dept: 'Computer Science', level: 3, courses: [
      { code: 'CS401', title: 'Software Engineering', t: 'tchoumi', kind: 'Lecture', size: 38, pref: ['B301', 'B201'] },
      { code: 'CS405', title: 'Operating Systems', t: 'raman', kind: 'Lecture', size: 38, pref: ['B305', 'B206'] },
      { code: 'CS410', title: 'Artificial Intelligence', t: 'okafor', kind: 'Lecture', size: 38, pref: ['A202', 'A101'] },
      { code: 'CS420', title: 'Mobile App Development', t: 'vance', kind: 'Lab', size: 36, pref: ['B303', 'B304'] },
      { code: 'CS430', title: 'Cloud Computing', t: 'ayuk', kind: 'Lecture', size: 38, pref: ['B206', 'B105'] },
    ],
  },
  {
    dept: 'Engineering', level: 2, courses: [
      { code: 'EE210', title: 'Circuit Analysis', t: 'fofang', kind: 'Lecture', size: 42, pref: ['C101', 'C102'] },
      { code: 'EE220', title: 'Digital Electronics Lab', t: 'bih', kind: 'Lab', size: 30, pref: ['C004', 'C103'] },
      { code: 'ME205', title: 'Thermodynamics', t: 'fofang', kind: 'Lecture', size: 42, pref: ['C201', 'C102'] },
      { code: 'ENG202', title: 'Technical Writing for Engineers', t: 'mbarga', kind: 'Lecture', size: 42, pref: ['C105', 'C202'] },
      { code: 'MATH250', title: 'Engineering Mathematics', t: 'okafor', kind: 'Lecture', size: 42, pref: ['C003', 'C101'] },
    ],
  },
  {
    dept: 'Business', level: 1, courses: [
      { code: 'BUS101', title: 'Principles of Management', t: 'ndzi', kind: 'Lecture', size: 60, pref: ['A101', 'A102'] },
      { code: 'ACC110', title: 'Financial Accounting', t: 'nkeng', kind: 'Lecture', size: 60, pref: ['A201', 'A102'] },
      { code: 'ECO105', title: 'Microeconomics', t: 'okafor', kind: 'Lecture', size: 60, pref: ['A103', 'A202'] },
      { code: 'COM101', title: 'Business Communication', t: 'mbarga', kind: 'Lecture', size: 55, pref: ['A105', 'A203'] },
      { code: 'IT101', title: 'Computer Applications', t: 'tchoumi', kind: 'Lab', size: 38, pref: ['A104', 'B104'] },
    ],
  },
];

// Weekly rhythm (minutes from midnight)
const SLOTS = [
  [510, 600], // 08:30 - 10:00
  [615, 705], // 10:15 - 11:45
  [780, 870], // 13:00 - 14:30
  [900, 1020], // 15:00 - 17:00
];

export function seedDatabase(db, { reset = false } = {}) {
  if (reset) {
    for (const t of ['notification_reads', 'notifications', 'favorites', 'recents', 'change_requests', 'issues', 'feedback', 'announcements', 'timetable', 'courses', 'graph_edges', 'graph_nodes', 'halls', 'floors', 'buildings', 'users']) {
      db.exec(`DELETE FROM ${t}`);
    }
    db.exec(`DELETE FROM sqlite_sequence`);
  }
  const existing = db.prepare('SELECT COUNT(*) AS n FROM buildings').get().n;
  if (existing > 0) return false;

  const hash = bcrypt.hashSync(DEMO_PASSWORD, 10);

  tx(db, () => {
    // ---- Campus ----
    const campus = buildCampus();
    const bId = {};
    for (const b of campus.buildings) {
      bId[b.code] = Number(
        db.prepare('INSERT INTO buildings (code,name,tagline,color,ox,oy,ow,oh,ex,ey) VALUES (?,?,?,?,?,?,?,?,?,?)')
          .run(b.code, b.name, b.tagline, b.color, b.ox, b.oy, b.ow, b.oh, b.ex, b.ey).lastInsertRowid,
      );
    }
    const fId = {};
    for (const f of campus.floors) {
      fId[`${f.building}:${f.level}`] = Number(
        db.prepare('INSERT INTO floors (building_id,level,label,name) VALUES (?,?,?,?)').run(bId[f.building], f.level, f.label, f.name).lastInsertRowid,
      );
    }
    const insNode = db.prepare('INSERT INTO graph_nodes (id,floor_id,x,y,kind,hall_code) VALUES (?,?,?,?,?,?)');
    for (const n of campus.nodes) insNode.run(n.id, n.floorKey ? fId[n.floorKey] : null, n.x, n.y, n.kind, n.hall);
    const insEdge = db.prepare('INSERT INTO graph_edges (a,b,meters,kind,geo) VALUES (?,?,?,?,?)');
    for (const e of campus.edges) insEdge.run(e.a, e.b, e.meters, e.kind, e.geo);
    const insHall = db.prepare(`INSERT INTO halls (code,name,building_id,floor_id,type,kind,capacity,equipment,description,featured,x,y,w,h,side,door_x,door_y,node_id)
                                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    for (const h of campus.halls) {
      const tag = `${h.building}${h.level}`;
      insHall.run(h.code, h.name, bId[h.building], fId[h.floorKey], h.type, h.kind, h.capacity, JSON.stringify(h.equipment), h.description, h.featured ? 1 : 0,
        h.x, h.y, h.w, h.h, h.side, h.doorX, h.doorY, `${tag}:d:${h.code}`);
    }

    // ---- Users ----
    const insUser = db.prepare(`INSERT INTO users (name,email,password_hash,role,school_id,department,level,onboarded) VALUES (?,?,?,?,?,?,?,?)`);
    const tId = {};
    for (const t of TEACHERS) tId[t.key] = Number(insUser.run(t.name, t.email, hash, 'teacher', t.sid, t.dept, null, 1).lastInsertRowid);
    for (const s of STUDENTS) insUser.run(s.name, s.email, hash, 'student', s.sid, s.dept, s.level, s.email === 'student@hallfinder.demo' ? 0 : 1);
    insUser.run('Campus Admin', 'admin@hallfinder.demo', hash, 'admin', 'A-0001', 'Administration', null, 1);

    // ---- Courses & timetable ----
    const hallByCode = new Map(db.prepare('SELECT id, code, type, capacity FROM halls').all().map((h) => [h.code, h]));
    const insCourse = db.prepare('INSERT INTO courses (code,title,department,level,teacher_id,class_size,color) VALUES (?,?,?,?,?,?,?)');
    const insTT = db.prepare('INSERT INTO timetable (course_id,hall_id,day,start_min,end_min,kind) VALUES (?,?,?,?,?,?)');
    let colour = 0;
    for (const g of GROUPS) {
      const courses = g.courses.map((c) => ({
        ...c,
        id: Number(insCourse.run(c.code, c.title, g.dept, g.level, tId[c.t], c.size, COLORS[colour++ % COLORS.length]).lastInsertRowid),
        used: 0,
      }));
      const candidates = (c) => {
        const want = c.kind === 'Lab' ? ['lab'] : ['lecture', 'auditorium'];
        const rest = [...hallByCode.values()]
          .filter((h) => want.includes(h.type) && h.capacity >= Math.min(c.size, 30))
          .map((h) => h.code);
        return [...new Set([...c.pref, ...rest])];
      };
      let cursor = 0;
      for (let day = 1; day <= 5; day++) {
        const slots = day === 5 ? SLOTS.slice(0, 3) : SLOTS;
        const today = new Set();
        slots.forEach(([start, end], si) => {
          // lab-type courses love the long 15:00 slot
          const pool = courses.filter((c) => !today.has(c.code));
          const preferLab = si === 3 ? pool.filter((c) => c.kind === 'Lab') : [];
          const list = preferLab.length ? preferLab : pool.length ? pool : courses;
          list.sort((a, b) => a.used - b.used);
          const c = list[(cursor++) % Math.min(list.length, 2)] || list[0];
          for (const code of candidates(c)) {
            const hall = hallByCode.get(code);
            if (!hall) continue;
            if (findConflicts(db, { hallId: hall.id, courseId: c.id, day, startMin: start, endMin: end }).length) continue;
            insTT.run(c.id, hall.id, day, start, end, c.kind);
            c.used++;
            today.add(c.code);
            return;
          }
        });
      }
    }

    // ---- Announcements, notifications, issues ----
    const ann = db.prepare('INSERT INTO announcements (title, body, level) VALUES (?,?,?)');
    ann.run('Elevator C under maintenance Friday 14:00 – 16:00', 'Engineering Complex. Use the stairs or Elevator B on the plaza side.', 'warning');
    ann.run('Library extended hours this week', 'The Central Library stays open until 20:00 until the end of exams.', 'info');
    ann.run('Welcome to HallFinder', 'Scan the QR code next to any hall door to set your location and get directions.', 'info');

    const alex = db.prepare(`SELECT id FROM users WHERE email = 'student@hallfinder.demo'`).get().id;
    const ins = db.prepare('INSERT INTO notifications (user_id, audience, title, body, type, hall_code) VALUES (?,?,?,?,?,?)');
    ins.run(alex, null, 'Hall change: Discrete Mathematics', 'MATH240 moved to Amphitheatre 1 (A005) this Thursday.', 'change', 'A005');
    ins.run(alex, null, 'Class cancelled', 'ENG201 Technical Writing on Friday is cancelled by Dr. Mbarga.', 'cancelled', null);
    ins.run(null, 'all', 'Mid-semester exams start next Monday', 'Check your timetable for hall changes before each paper.', 'info', null);

    const b105 = hallByCode.get('B105');
    db.prepare('INSERT INTO issues (hall_id, reporter_id, kind, details) VALUES (?,?,?,?)').run(b105.id, tId.tchoumi, 'projector', 'Projector flickers after 10 minutes.');
  });
  return true;
}

// CLI: node src/seed.js [--reset]
if (process.argv[1] && process.argv[1].endsWith('seed.js')) {
  const db = openDb();
  const did = seedDatabase(db, { reset: process.argv.includes('--reset') });
  const n = db.prepare('SELECT COUNT(*) AS n FROM halls WHERE kind = ?').get('room').n;
  console.log(did ? `Seeded ${BUILDINGS.length} buildings and ${n} halls.` : 'Database already seeded (use --reset to rebuild).');
}
