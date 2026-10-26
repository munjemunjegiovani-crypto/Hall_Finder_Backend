import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { seedDatabase } from '../src/seed.js';
import { createApp } from '../src/app.js';

const db = openDb(':memory:');
seedDatabase(db);
const server = createApp(db).listen(0);
const base = `http://127.0.0.1:${server.address().port}/api`;
test.after(() => server.close());

// Monday 10:00 school time (Africa/Douala = UTC+1)
const MON_10 = '2026-10-26T09:00:00Z';
const call = async (path, { token, method = 'GET', body, now = MON_10 } = {}) => {
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Demo-Now': now, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json() };
};
const login = async (email) => (await call('/auth/login', { method: 'POST', body: { email, password: 'demo1234' } })).data.token;

test('campus has 40+ halls', async () => {
  const { data } = await call('/campus');
  assert.ok(data.hallCount >= 40, `hallCount=${data.hallCount}`);
  assert.equal(data.buildings.length, 3);
});

test('login rejects wrong password, accepts demo', async () => {
  const bad = await call('/auth/login', { method: 'POST', body: { email: 'student@hallfinder.demo', password: 'nope' } });
  assert.equal(bad.status, 401);
  const ok = await call('/auth/login', { method: 'POST', body: { email: 'student@hallfinder.demo', password: 'demo1234' } });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.user.role, 'student');
});

test('route inside one corridor gives turn-by-turn with door ordinal', async () => {
  const { status, data } = await call('/route?from=B201&to=B204');
  assert.equal(status, 200);
  console.log(data.steps.map((s) => `${s.kind}: ${s.text} | ${s.detail}`).join('\n'));
  assert.equal(data.steps.at(-1).kind, 'arrive');
  assert.ok(data.distanceM > 0);
});

test('route from main gate to B204 crosses plaza, enters, takes stairs or lift', async () => {
  const { data } = await call('/route?from=gate&to=B204');
  console.log(data.steps.map((s) => `${s.kind}: ${s.text} | ${s.detail} (${s.meters} m)`).join('\n'));
  const kinds = data.steps.map((s) => s.kind);
  assert.ok(kinds.includes('outdoor') && kinds.includes('enter'));
  assert.ok(kinds.some((k) => k.startsWith('stairs') || k.startsWith('elevator')));
  assert.equal(data.to.code, 'B204');
});

test('accessible route never uses stairs', async () => {
  const { data } = await call('/route?from=gate&to=B204&accessible=1');
  assert.equal(data.usesStairs, false);
  assert.ok(data.steps.some((s) => s.kind.startsWith('elevator')));
});

test('cross-building route A -> C works both directions', async () => {
  const a = await call('/route?from=A102&to=C201');
  const c = await call('/route?from=C201&to=A102');
  assert.equal(a.status, 200);
  assert.equal(c.status, 200);
  console.log(c.data.steps.map((s) => `${s.kind}: ${s.text} | ${s.detail}`).join('\n'));
  assert.ok(a.data.steps.some((s) => s.kind === 'exit'));
});

test('opposite doors on a corridor are described as such', async () => {
  const { data } = await call('/route?from=B101&to=B104');
  assert.ok(data.steps.some((s) => s.kind === 'cross'));
});

test('student dashboard shows next class and today list', async () => {
  const token = await login('student@hallfinder.demo');
  const { data } = await call('/dashboard', { token });
  assert.ok(data.today.length >= 3);
  assert.ok(data.next || data.current);
  console.log('today:', data.today.map((e) => `${e.start} ${e.courseCode} ${e.hallCode} ${e.phase}`).join(' | '));
});

test('timetable has no double bookings', async () => {
  const admin = await login('admin@hallfinder.demo');
  const { data } = await call('/admin/timetable', { token: admin });
  assert.equal(data.conflicts.length, 0);
  assert.ok(data.entries.length > 40);
});

test('admin conflict detection blocks double-booking a hall', async () => {
  const admin = await login('admin@hallfinder.demo');
  const tt = (await call('/admin/timetable', { token: admin })).data.entries[0];
  const other = (await call('/admin/courses', { token: admin })).data.courses.find((c) => c.id !== tt.courseId && c.department !== tt.department);
  const res = await call('/admin/timetable', { token: admin, method: 'POST', body: { courseId: other.id, hallCode: tt.hallCode, day: tt.day, start: tt.start, end: tt.end, kind: 'Lecture' } });
  assert.equal(res.status, 409);
  assert.ok(res.data.conflicts.some((c) => c.type === 'hall'));
});

test('students cannot use admin routes', async () => {
  const token = await login('student@hallfinder.demo');
  const res = await call('/admin/stats', { token });
  assert.equal(res.status, 403);
});

test('teacher reminders appear inside the reminder window', async () => {
  const token = await login('teacher@hallfinder.demo');
  const t = (await call('/timetable', { token })).data;
  const first = t.entries.find((e) => e.day === 1);
  assert.ok(first);
  const mins = first.startMin - 10; // 10 minutes before
  const hh = String(Math.floor(mins / 60) - 1).padStart(2, '0'); // school time -> UTC
  const mm = String(mins % 60).padStart(2, '0');
  const { data } = await call('/notifications', { token, now: `2026-10-26T${hh}:${mm}:00Z` });
  assert.ok(data.reminders.some((r) => r.type === 'reminder'), JSON.stringify(data.reminders));
});

test('hall detail has live status and schedule', async () => {
  const { data } = await call('/halls/B204');
  assert.equal(data.hall.code, 'B204');
  assert.ok(['free', 'soon', 'in_use', 'closed', 'locked'].includes(data.hall.status.state));
  assert.ok(Array.isArray(data.schedule));
});
