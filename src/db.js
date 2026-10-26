import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DB_PATH = process.env.DATABASE_PATH
  ? path.resolve(process.env.DATABASE_PATH)
  : path.resolve(__dirname, '../data/hallfinder.db');

export function openDb(file = DB_PATH) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  return db;
}

/** Runs fn inside a transaction (node:sqlite has no helper for it). */
export function tx(db, fn) {
  db.exec('BEGIN');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('student','teacher','admin')),
  school_id TEXT,
  department TEXT,
  level INTEGER,
  language TEXT NOT NULL DEFAULT 'en',
  theme TEXT NOT NULL DEFAULT 'system',
  reminder_minutes INTEGER NOT NULL DEFAULT 15,
  notify_push INTEGER NOT NULL DEFAULT 1,
  notify_email INTEGER NOT NULL DEFAULT 0,
  accessible_routes INTEGER NOT NULL DEFAULT 0,
  onboarded INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS buildings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  tagline TEXT,
  color TEXT,
  ox REAL, oy REAL, ow REAL, oh REAL, ex REAL, ey REAL
);

CREATE TABLE IF NOT EXISTS floors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  building_id INTEGER NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
  level INTEGER NOT NULL,
  label TEXT NOT NULL,
  name TEXT NOT NULL,
  UNIQUE (building_id, level)
);

CREATE TABLE IF NOT EXISTS halls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  building_id INTEGER NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
  floor_id INTEGER NOT NULL REFERENCES floors(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'room',
  capacity INTEGER NOT NULL DEFAULT 0,
  equipment TEXT NOT NULL DEFAULT '[]',
  description TEXT,
  featured INTEGER NOT NULL DEFAULT 0,
  x REAL, y REAL, w REAL, h REAL,
  side TEXT,
  door_x REAL, door_y REAL,
  node_id TEXT
);

CREATE TABLE IF NOT EXISTS graph_nodes (
  id TEXT PRIMARY KEY,
  floor_id INTEGER REFERENCES floors(id) ON DELETE CASCADE,
  x REAL NOT NULL, y REAL NOT NULL,
  kind TEXT NOT NULL,
  hall_code TEXT
);

CREATE TABLE IF NOT EXISTS graph_edges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  a TEXT NOT NULL REFERENCES graph_nodes(id) ON DELETE CASCADE,
  b TEXT NOT NULL REFERENCES graph_nodes(id) ON DELETE CASCADE,
  meters REAL NOT NULL,
  kind TEXT NOT NULL DEFAULT 'walk',
  geo TEXT
);

CREATE TABLE IF NOT EXISTS courses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  department TEXT NOT NULL,
  level INTEGER NOT NULL,
  teacher_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  class_size INTEGER NOT NULL DEFAULT 40,
  color TEXT
);

CREATE TABLE IF NOT EXISTS timetable (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  hall_id INTEGER NOT NULL REFERENCES halls(id) ON DELETE CASCADE,
  day INTEGER NOT NULL CHECK (day BETWEEN 1 AND 7),
  start_min INTEGER NOT NULL,
  end_min INTEGER NOT NULL,
  kind TEXT NOT NULL DEFAULT 'Lecture',
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','cancelled')),
  note TEXT
);
CREATE INDEX IF NOT EXISTS idx_tt_day ON timetable(day, start_min);
CREATE INDEX IF NOT EXISTS idx_tt_hall ON timetable(hall_id, day);

CREATE TABLE IF NOT EXISTS favorites (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  hall_id INTEGER NOT NULL REFERENCES halls(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, hall_id)
);

CREATE TABLE IF NOT EXISTS recents (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  hall_id INTEGER NOT NULL REFERENCES halls(id) ON DELETE CASCADE,
  visited_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, hall_id)
);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  audience TEXT,
  title TEXT NOT NULL,
  body TEXT,
  type TEXT NOT NULL DEFAULT 'info',
  hall_code TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS notification_reads (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  notification_id INTEGER NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, notification_id)
);

CREATE TABLE IF NOT EXISTS announcements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  body TEXT,
  level TEXT NOT NULL DEFAULT 'info' CHECK (level IN ('info','warning','urgent')),
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS issues (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hall_id INTEGER NOT NULL REFERENCES halls(id) ON DELETE CASCADE,
  reporter_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  kind TEXT NOT NULL,
  details TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS change_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timetable_id INTEGER NOT NULL REFERENCES timetable(id) ON DELETE CASCADE,
  teacher_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  requested_hall_id INTEGER NOT NULL REFERENCES halls(id) ON DELETE CASCADE,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','declined')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  message TEXT NOT NULL,
  rating INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;
