// Campus blueprint: buildings, floors, halls and the walking graph used for routing.
// Everything here is generated from compact tables, so adding a hall is a one-line change.
//
// Floor plan template (SVG units, 1 unit = 0.1 m, so a corridor of 880 units is 88 m):
//
//   y=40..240   [Stairs][  N1  ][  N2  ][  N3  ][Restroom]
//   y=245..315  ==================== corridor ===========
//   y=320..520  [ Lift ][  S1  ][  S2  ][  S3  ][ Exit  ]
//
// Building "C" is mirrored left/right so the entrance sits on the other end.

export const FLOOR_W = 1000;
export const FLOOR_H = 560;
export const CORRIDOR_Y = 280;
export const UNIT_TO_M = 0.1;

export const PLAZA = { id: 'plaza', name: 'Campus Plaza', x: 500, y: 330 };
export const GATE = { id: 'gate', name: 'Main Gate', x: 500, y: 570 };

export const BUILDINGS = [
  {
    code: 'A',
    name: 'Main Block',
    tagline: 'Library, cafeteria, administration',
    color: '#1E3A8A',
    mirror: false,
    ox: 60, oy: 90, ow: 300, oh: 170,
    ex: 210, ey: 262,
    plazaPath: [[500, 330], [210, 330], [210, 262]],
    plazaMeters: 64,
    floors: ['G', '1', '2'],
  },
  {
    code: 'B',
    name: 'Science & Tech Building',
    tagline: 'Lecture halls, computer and science labs',
    color: '#0F766E',
    mirror: false,
    ox: 640, oy: 70, ow: 300, oh: 190,
    ex: 790, ey: 262,
    plazaPath: [[500, 330], [790, 330], [790, 262]],
    plazaMeters: 80,
    floors: ['G', '1', '2', '3'],
  },
  {
    code: 'C',
    name: 'Engineering Complex',
    tagline: 'Workshops, electronics and design studios',
    color: '#7C3AED',
    mirror: true,
    ox: 640, oy: 390, ow: 300, oh: 150,
    ex: 790, ey: 390,
    plazaPath: [[500, 330], [790, 330], [790, 390]],
    plazaMeters: 90,
    floors: ['G', '1', '2'],
  },
];

// slots: N1 N2 N3 (north side) and S1 S2 S3 (south side)
// [slot, code-suffix, name, type, capacity, extra]
const R = (slot, n, name, type, cap, extra = {}) => ({ slot, n, name, type, cap, ...extra });

export const ROOMS = {
  A: {
    G: [
      R('N1', '01', 'Central Library', 'library', 220, { desc: 'Silent study floor, reading tables, book lending desk and 40 study carrels.' }),
      R('N2', '02', 'Main Cafeteria', 'cafeteria', 160, { desc: 'Hot meals, snacks and coffee. Open from 7:00 to 19:00.' }),
      R('N3', '03', 'Admissions & Registrar Office', 'office', 12, { desc: 'Enrolment, transcripts, ID cards and fee clearance.' }),
      R('S1', '04', 'Student Services', 'office', 10, { desc: 'Counselling, student clubs and lost-and-found.' }),
      R('S2', '05', 'Amphitheatre 1', 'auditorium', 300, { desc: 'Tiered auditorium for large lectures, ceremonies and guest talks.' }),
      R('S3', '06', 'Health Clinic', 'office', 8, { desc: 'First aid and a visiting nurse during school hours.' }),
    ],
    1: [
      R('N1', '01', 'Lecture Hall A101', 'lecture', 120),
      R('N2', '02', 'Lecture Hall A102', 'lecture', 90),
      R('N3', '03', 'Lecture Hall A103', 'lecture', 80),
      R('S1', '04', 'Business Computing Lab', 'lab', 40),
      R('S2', '05', 'Seminar Room A105', 'seminar', 30),
      R('S3', '06', 'Faculty Lounge', 'office', 20),
    ],
    2: [
      R('N1', '01', 'Lecture Hall A201', 'lecture', 100),
      R('N2', '02', 'Lecture Hall A202', 'lecture', 100),
      R('N3', '03', 'Seminar Room A203', 'seminar', 40),
      R('S1', '04', 'Language Lab', 'lab', 36),
      R('S2', '05', 'Moot Room', 'seminar', 30),
      R('S3', '06', "Dean's Office", 'office', 10),
    ],
  },
  B: {
    G: [
      R('N1', '01', 'Physics Lab', 'lab', 40),
      R('N2', '02', 'Chemistry Lab', 'lab', 36),
      R('N3', '03', 'Lecture Hall B003', 'lecture', 150),
      R('S1', '04', 'Biology Lab', 'lab', 36),
      R('S2', '05', 'Science Department Office', 'office', 12),
      R('S3', '06', 'Study Lounge B', 'lounge', 50, { desc: 'Quiet lounge with sockets, free Wi-Fi and group tables.' }),
    ],
    1: [
      R('N1', '01', 'Lecture Hall B101', 'lecture', 120),
      R('N2', '02', 'Lecture Hall B102', 'lecture', 100),
      R('N3', '03', 'Computer Lab 1', 'lab', 50),
      R('S1', '04', 'Computer Lab 2', 'lab', 50),
      R('S2', '05', 'Lecture Hall B105', 'lecture', 90),
      R('S3', '06', 'Faculty Offices B1', 'office', 20),
    ],
    2: [
      R('N1', '01', 'Lecture Hall B201', 'lecture', 60),
      R('N2', '02', 'Computer Lab 3', 'lab', 60),
      R('N3', '03', 'Faculty Offices B2', 'office', 20),
      R('S1', '04', 'Albert Einstein Memorial Hall', 'lecture', 120, { featured: true, desc: 'Flagship lecture hall with a 4K projector, tiered seating and live-stream equipment.' }),
      R('S2', '05', 'Robotics Lab', 'lab', 30, { desc: 'Badge access only. Robotics kits, 3D printers and soldering stations.' }),
      R('S3', '06', 'Lecture Hall B206', 'lecture', 80),
    ],
    3: [
      R('N1', '01', 'Lecture Hall B301', 'lecture', 100),
      R('N2', '02', 'Seminar Room B302', 'seminar', 35),
      R('N3', '03', 'Tech Lab 3', 'lab', 45),
      R('S1', '04', 'Innovation Hub', 'lab', 40),
      R('S2', '05', 'Lecture Hall B305', 'lecture', 90),
      R('S3', '06', 'Study Lounge 3', 'lounge', 40, { desc: 'Rooftop-level lounge with the best view of the plaza.' }),
    ],
  },
  C: {
    G: [
      R('N1', '01', 'Engineering Workshop', 'lab', 40),
      R('N2', '02', 'Machine Lab', 'lab', 30),
      R('N3', '03', 'Lecture Hall C003', 'lecture', 140),
      R('S1', '04', 'Electronics Lab', 'lab', 36),
      R('S2', '05', 'Engineering Department Office', 'office', 12),
      R('S3', '06', 'Student Lounge C', 'lounge', 45),
    ],
    1: [
      R('N1', '01', 'Lecture Hall C101', 'lecture', 110),
      R('N2', '02', 'Lecture Hall C102', 'lecture', 110),
      R('N3', '03', 'Circuits Lab', 'lab', 36),
      R('S1', '04', 'CAD Studio', 'lab', 40),
      R('S2', '05', 'Lecture Hall C105', 'lecture', 60),
      R('S3', '06', 'Engineering Seminar Room', 'seminar', 30),
    ],
    2: [
      R('N1', '01', 'Lecture Hall C201', 'lecture', 100),
      R('N2', '02', 'Lecture Hall C202', 'lecture', 100),
      R('N3', '03', 'Thermodynamics Lab', 'lab', 30),
      R('S1', '04', 'Design Studio', 'lab', 40),
      R('S2', '05', 'Project Room C205', 'seminar', 25),
      R('S3', '06', 'Faculty Offices C2', 'office', 20),
    ],
  },
};

const EQUIPMENT = {
  lecture: ['Projector', 'Air conditioning', 'Whiteboard', 'Power sockets', 'Microphone'],
  lab: ['Workstations', 'Air conditioning', 'Projector', 'Power sockets', 'Lab technician'],
  seminar: ['Smart TV', 'Whiteboard', 'Power sockets', 'Air conditioning'],
  auditorium: ['4K projector', 'PA system', 'Air conditioning', 'Stage lighting', 'Live stream'],
  library: ['Free Wi-Fi', 'Power sockets', 'Silent zone', 'Printing'],
  cafeteria: ['Seating', 'Free Wi-Fi', 'Water station'],
  lounge: ['Free Wi-Fi', 'Power sockets', 'Group tables', 'Water station'],
  office: ['Reception desk', 'Waiting area'],
};

const SLOT_BOX = {
  N1: { x: 140, y: 40, w: 220, h: 200, side: 'N' },
  N2: { x: 370, y: 40, w: 220, h: 200, side: 'N' },
  N3: { x: 600, y: 40, w: 220, h: 200, side: 'N' },
  S1: { x: 140, y: 320, w: 220, h: 200, side: 'S' },
  S2: { x: 370, y: 320, w: 220, h: 200, side: 'S' },
  S3: { x: 600, y: 320, w: 220, h: 200, side: 'S' },
};
const FACILITY_BOX = {
  stairs: { x: 50, y: 40, w: 80, h: 200, side: 'N', cx: 90 },
  elevator: { x: 50, y: 320, w: 80, h: 200, side: 'S', cx: 90 },
  restroom: { x: 830, y: 40, w: 120, h: 200, side: 'N', cx: 890 },
  exit: { x: 830, y: 320, w: 120, h: 200, side: 'S', cx: 890 },
};

function box(b, mirror) {
  if (!mirror) return { ...b };
  return { ...b, x: FLOOR_W - (b.x + b.w), cx: b.cx === undefined ? undefined : FLOOR_W - b.cx };
}
const mx = (x, mirror) => (mirror ? FLOOR_W - x : x);

const levelOf = (f) => (f === 'G' ? 0 : Number(f));
const floorName = (f) => (f === 'G' ? 'Ground Floor' : `Floor ${f}`);

/** Builds every record needed by the database. Pure function: same input, same output. */
export function buildCampus() {
  const buildings = [];
  const floors = [];
  const halls = [];
  const nodes = [];
  const edges = [];

  const addEdge = (a, b, meters, kind = 'walk', geo = null) =>
    edges.push({ a, b, meters: Math.round(meters * 10) / 10, kind, geo });

  for (const b of BUILDINGS) {
    buildings.push({
      code: b.code, name: b.name, tagline: b.tagline, color: b.color,
      ox: b.ox, oy: b.oy, ow: b.ow, oh: b.oh, ex: b.ex, ey: b.ey, floorCount: b.floors.length,
    });
    const prevLevel = {};
    for (const f of b.floors) {
      const level = levelOf(f);
      floors.push({ building: b.code, level, label: f, name: floorName(f) });
      const tag = `${b.code}${level}`;
      const floorHalls = [];

      // Rooms
      for (const r of ROOMS[b.code][f]) {
        const sb = box(SLOT_BOX[r.slot], b.mirror);
        const code = `${b.code}${level}${r.n}`;
        floorHalls.push({
          code, name: r.name, building: b.code, level, type: r.type, kind: 'room', capacity: r.cap,
          equipment: EQUIPMENT[r.type] || [], description: r.desc || null, featured: !!r.featured,
          x: sb.x, y: sb.y, w: sb.w, h: sb.h, side: sb.side,
          doorX: sb.x + sb.w / 2, doorY: sb.side === 'N' ? 245 : 315, slot: r.slot,
        });
      }
      // Facilities
      const fac = (type, name, code) => {
        const fb = box(FACILITY_BOX[type], b.mirror);
        floorHalls.push({
          code, name, building: b.code, level, type, kind: 'facility', capacity: 0, equipment: [],
          description: null, featured: false,
          x: fb.x, y: fb.y, w: fb.w, h: fb.h, side: fb.side,
          doorX: fb.cx, doorY: fb.side === 'N' ? 245 : 315, slot: type,
        });
      };
      fac('stairs', `Stairs ${b.code}`, `${tag}-ST`);
      fac('elevator', `Elevator ${b.code}`, `${tag}-EL`);
      fac('restroom', `Restrooms ${floorName(f)}`, `${tag}-WC`);
      fac('exit', f === 'G' ? `Fire Exit ${b.code}` : `Emergency Exit ${b.code}${level}`, `${tag}-EX`);

      const floorKey = `${b.code}:${level}`;
      for (const h of floorHalls) halls.push({ ...h, floorKey });

      // Corridor nodes: one per distinct door x
      const xs = [...new Set(floorHalls.map((h) => h.doorX))].sort((p, q) => p - q);
      const corr = (x) => `${tag}:c:${x}`;
      for (const x of xs) nodes.push({ id: corr(x), floorKey, x, y: CORRIDOR_Y, kind: 'corridor', hall: null });
      for (let i = 1; i < xs.length; i++) addEdge(corr(xs[i - 1]), corr(xs[i]), (xs[i] - xs[i - 1]) * UNIT_TO_M);

      // Door nodes
      for (const h of floorHalls) {
        const id = `${tag}:d:${h.code}`;
        nodes.push({ id, floorKey, x: h.doorX, y: h.doorY, kind: 'door', hall: h.code });
        addEdge(id, corr(h.doorX), Math.abs(h.doorY - CORRIDOR_Y) * UNIT_TO_M);
      }

      // Entrance on the ground floor, sits at the corridor end on the building's entrance side
      if (f === 'G') {
        const ex = mx(30, b.mirror);
        const nearest = mx(90, b.mirror);
        nodes.push({ id: `${b.code}:entrance`, floorKey, x: ex, y: CORRIDOR_Y, kind: 'entrance', hall: null });
        addEdge(`${b.code}:entrance`, corr(nearest), Math.abs(ex - nearest) * UNIT_TO_M);
        addEdge('plaza', `${b.code}:entrance`, b.plazaMeters, 'outdoor', JSON.stringify(b.plazaPath));
      }

      // Vertical links to the floor below
      if (prevLevel.level !== undefined) {
        const lo = `${b.code}${prevLevel.level}`;
        addEdge(`${lo}:d:${lo}-ST`, `${tag}:d:${tag}-ST`, 14, 'stairs');
        addEdge(`${lo}:d:${lo}-EL`, `${tag}:d:${tag}-EL`, 10, 'elevator');
      }
      prevLevel.level = level;
    }
  }

  // Outdoor nodes (floorKey null)
  nodes.push({ id: 'plaza', floorKey: null, x: PLAZA.x, y: PLAZA.y, kind: 'plaza', hall: null });
  nodes.push({ id: 'gate', floorKey: null, x: GATE.x, y: GATE.y, kind: 'gate', hall: null });
  addEdge('gate', 'plaza', 140, 'outdoor', JSON.stringify([[500, 570], [500, 330]]));

  return { buildings, floors, halls, nodes, edges };
}

export const DAY_NAMES = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
