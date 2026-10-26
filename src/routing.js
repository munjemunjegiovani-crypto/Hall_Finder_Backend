// Indoor + outdoor wayfinding: Dijkstra over the campus graph, then a human-friendly
// turn-by-turn generator ("Turn left and walk 40 m. Hall B204 is the 3rd door on your right").

const WALK_SPEED = 1.35; // metres per second
const STAIR_SECONDS = 12; // per floor
const LIFT_SECONDS = 22; // per floor (waiting included)

const caches = new WeakMap();
export const invalidateGraph = (db) => caches.delete(db);

export function loadGraph(db) {
  if (caches.has(db)) return caches.get(db);
  const nodeRows = db.prepare(`
    SELECT n.id, n.x, n.y, n.kind, n.hall_code AS hallCode, n.floor_id AS floorId,
           f.level, f.label AS floorLabel, f.name AS floorName, b.code AS buildingCode, b.name AS buildingName
    FROM graph_nodes n
    LEFT JOIN floors f ON f.id = n.floor_id
    LEFT JOIN buildings b ON b.id = f.building_id`).all();
  const nodes = new Map(nodeRows.map((n) => [n.id, { ...n }]));
  const adj = new Map();
  for (const n of nodes.values()) adj.set(n.id, []);
  const edgeRows = db.prepare('SELECT a, b, meters, kind, geo FROM graph_edges').all();
  for (const e of edgeRows) {
    const geo = e.geo ? JSON.parse(e.geo) : null;
    adj.get(e.a).push({ to: e.b, meters: e.meters, kind: e.kind, geo, forward: true });
    adj.get(e.b).push({ to: e.a, meters: e.meters, kind: e.kind, geo, forward: false });
  }
  const halls = new Map(
    db.prepare(`SELECT h.code, h.name, h.type, h.kind, h.node_id AS nodeId, b.code AS building, f.level, f.name AS floorName
                FROM halls h JOIN buildings b ON b.id = h.building_id JOIN floors f ON f.id = h.floor_id`)
      .all().map((h) => [h.code, { ...h }]),
  );
  const g = { nodes, adj, halls };
  caches.set(db, g);
  return g;
}

/** Turns "B204", "gate", "plaza", "entrance:B" into a graph node. */
export function locate(g, token) {
  if (!token) return null;
  const t = String(token).trim();
  const up = t.toUpperCase();
  if (g.halls.has(up)) {
    const h = g.halls.get(up);
    return { node: g.nodes.get(h.nodeId), label: h.name, code: h.code, hall: h };
  }
  if (t.toLowerCase() === 'gate') return { node: g.nodes.get('gate'), label: 'Main Gate', code: 'GATE' };
  if (t.toLowerCase() === 'plaza') return { node: g.nodes.get('plaza'), label: 'Campus Plaza', code: 'PLAZA' };
  const m = /^entrance:([A-Z])$/i.exec(t);
  if (m && g.nodes.has(`${m[1].toUpperCase()}:entrance`)) {
    const node = g.nodes.get(`${m[1].toUpperCase()}:entrance`);
    return { node, label: `${node.buildingName} entrance`, code: `ENT-${m[1].toUpperCase()}` };
  }
  return null;
}

function dijkstra(g, startId, endId, { accessible }) {
  const dist = new Map([[startId, 0]]);
  const prev = new Map();
  const done = new Set();
  const queue = [[0, startId]];
  while (queue.length) {
    queue.sort((p, q) => p[0] - q[0]);
    const [d, id] = queue.shift();
    if (done.has(id)) continue;
    done.add(id);
    if (id === endId) break;
    for (const e of g.adj.get(id)) {
      if (accessible && e.kind === 'stairs') continue;
      const cost = e.kind === 'stairs' ? e.meters * 1.6 : e.kind === 'elevator' ? e.meters * 1.2 : e.meters;
      const nd = d + cost;
      if (nd < (dist.get(e.to) ?? Infinity)) {
        dist.set(e.to, nd);
        prev.set(e.to, { from: id, edge: e });
        queue.push([nd, e.to]);
      }
    }
  }
  if (!prev.has(endId) && startId !== endId) return null;
  const hops = [];
  let cur = endId;
  while (cur !== startId) {
    const p = prev.get(cur);
    hops.unshift({ from: p.from, to: cur, edge: p.edge });
    cur = p.from;
  }
  return hops;
}

const dirOf = (a, b) => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 'E' : 'W';
  return dy >= 0 ? 'S' : 'N';
};
const VEC = { E: [1, 0], W: [-1, 0], N: [0, -1], S: [0, 1] };
const turnOf = (d1, d2) => {
  if (d1 === d2) return 'straight';
  const [x1, y1] = VEC[d1];
  const [x2, y2] = VEC[d2];
  const cross = x1 * y2 - y1 * x2; // screen coordinates (y grows downwards): >0 = clockwise = right
  if (cross > 0) return 'right';
  if (cross < 0) return 'left';
  return 'back';
};
const ordinal = (n) => {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
};
const r1 = (n) => Math.round(n * 10) / 10;
const pt = (n) => ({ x: n.x, y: n.y });

function groupLegs(nodes, hops) {
  // hops are all 'walk' edges of one floor
  const legs = [];
  for (let i = 0; i < hops.length; i++) {
    const a = nodes[i];
    const b = nodes[i + 1];
    const dir = dirOf(a, b);
    const last = legs[legs.length - 1];
    if (last && last.dir === dir) {
      last.len += hops[i].edge.meters;
      last.nodes.push(b);
    } else {
      legs.push({ dir, len: hops[i].edge.meters, nodes: [a, b] });
    }
  }
  return legs;
}

export function planRoute(db, fromToken, toToken, { accessible = false } = {}) {
  const g = loadGraph(db);
  const from = locate(g, fromToken);
  const to = locate(g, toToken);
  if (!from) return { error: 'from_not_found' };
  if (!to) return { error: 'to_not_found' };
  const hops = from.node.id === to.node.id ? [] : dijkstra(g, from.node.id, to.node.id, { accessible });
  if (!hops) return { error: 'no_route' };

  const steps = [];
  const paths = [];
  const doorsOnFloor = (floorId, side) =>
    [...g.nodes.values()].filter((n) => n.floorId === floorId && n.kind === 'door' && (side === 'N' ? n.y < 280 : n.y > 280));

  const pushStep = (s) => steps.push({ id: steps.length + 1, meters: 0, seconds: 0, detail: '', ...s });
  const pushPath = (scope, node, points) => {
    if (!points.length) return;
    paths.push({
      scope,
      floorId: scope === 'indoor' ? node.floorId : null,
      building: scope === 'indoor' ? node.buildingCode : null,
      level: scope === 'indoor' ? node.level : null,
      stepId: steps.length,
      points,
    });
  };

  const startNode = from.node;
  const startName = from.label;
  pushStep({
    kind: 'start',
    text: `Start at ${startName}`,
    detail: startNode.buildingCode ? `${startNode.buildingName} · ${startNode.floorName}` : 'Campus grounds',
    building: startNode.buildingCode || null,
    level: startNode.level ?? null,
  });

  let i = 0;
  while (i < hops.length) {
    const hop = hops[i];
    const kind = hop.edge.kind;
    const fromNode = g.nodes.get(hop.from);
    if (kind === 'walk') {
      // collect same-floor walking run
      let j = i;
      const nodes = [fromNode];
      const run = [];
      while (j < hops.length && hops[j].edge.kind === 'walk') {
        run.push(hops[j]);
        nodes.push(g.nodes.get(hops[j].to));
        j++;
      }
      const startIsDoor = nodes[0].kind === 'door';
      const endIsDoor = nodes[nodes.length - 1].kind === 'door';
      const isFinal = j >= hops.length;
      const legs = groupLegs(nodes, run);
      const startHall = nodes[0].hallCode ? g.halls.get(nodes[0].hallCode) : null;
      const endHall = endIsDoor ? g.halls.get(nodes[nodes.length - 1].hallCode) : null;
      const base = { building: nodes[0].buildingCode, level: nodes[0].level, floorId: nodes[0].floorId, scope: 'indoor' };

      if (legs.length === 1 && startIsDoor && endIsDoor) {
        const m = r1(legs[0].len);
        pushStep({
          ...base, kind: 'cross', meters: m, seconds: Math.round(m / WALK_SPEED),
          text: `Cross the corridor`,
          detail: isFinal ? `${endHall.name} is directly opposite` : `${endHall.name} is directly opposite`,
          points: nodes.map(pt),
        });
      } else {
        const corrStart = startIsDoor ? 1 : 0;
        const corrEnd = endIsDoor ? legs.length - 1 : legs.length;
        const corridor = legs.slice(corrStart, corrEnd);
        let prevDir = startIsDoor ? legs[0].dir : null;
        corridor.forEach((leg, idx) => {
          const t = prevDir ? turnOf(prevDir, leg.dir) : 'straight';
          const m = r1(leg.len);
          const lastCorridorLeg = idx === corridor.length - 1;
          let text;
          if (idx === 0 && startIsDoor) {
            const lead = startHall?.type === 'elevator' ? 'Step out of the elevator'
              : startHall?.type === 'stairs' ? 'Leave the stairwell'
                : `Leave ${startName}`;
            text = `${lead} and turn ${t}`;
          } else if (idx === 0) {
            text = nodes[0].kind === 'entrance' ? 'Walk straight along the main corridor' : `Walk along the corridor`;
          } else {
            text = `Turn ${t}`;
          }
          let detail = `Walk ${Math.round(m)} m along the corridor`;
          if (lastCorridorLeg && endIsDoor && isFinal && endHall) {
            const side = turnOf(leg.dir, legs[legs.length - 1].dir); // left/right of the final door
            const doorNode = nodes[nodes.length - 1];
            const dside = doorNode.y < 280 ? 'N' : 'S';
            const sx = leg.nodes[0].x;
            const dx = doorNode.x;
            const lo = Math.min(sx, dx);
            const hi = Math.max(sx, dx);
            const between = doorsOnFloor(doorNode.floorId, dside).filter((d) => d.x > lo && d.x < hi).length;
            detail = `Walk ${Math.round(m)} m. ${endHall.name} is the ${ordinal(between + 1)} door on your ${side}`;
          }
          pushStep({
            ...base, kind: t === 'left' ? 'turn-left' : t === 'right' ? 'turn-right' : 'straight',
            meters: m, seconds: Math.round(m / WALK_SPEED), text, detail,
            points: leg.nodes.map(pt),
          });
          prevDir = leg.dir;
        });
        if (endIsDoor && !isFinal) {
          // heading into the stairs / elevator / exit
          const last = legs[legs.length - 1];
          const t = prevDir ? turnOf(prevDir, last.dir) : 'straight';
          pushStep({
            ...base, kind: t === 'left' ? 'turn-left' : t === 'right' ? 'turn-right' : 'straight',
            meters: r1(last.len), seconds: Math.round(last.len / WALK_SPEED),
            text: `Turn ${t} to the ${endHall.type === 'elevator' ? 'elevator' : endHall.type === 'stairs' ? 'stairs' : endHall.name}`,
            detail: `${Math.round(last.len)} m ahead`,
            points: last.nodes.map(pt),
          });
        }
      }
      pushPath('indoor', nodes[0], nodes.map(pt));
      i = j;
    } else if (kind === 'stairs' || kind === 'elevator') {
      let j = i;
      let last = fromNode;
      while (j < hops.length && hops[j].edge.kind === kind) {
        last = g.nodes.get(hops[j].to);
        j++;
      }
      const floors = Math.abs(last.level - fromNode.level);
      const up = last.level > fromNode.level;
      const secs = floors * (kind === 'stairs' ? STAIR_SECONDS : LIFT_SECONDS);
      pushStep({
        kind: `${kind}-${up ? 'up' : 'down'}`,
        scope: 'indoor', building: fromNode.buildingCode, level: last.level, floorId: last.floorId,
        meters: 0, seconds: secs,
        text: kind === 'stairs' ? `Take the stairs ${up ? 'up' : 'down'} to ${last.floorName}` : `Take the elevator to ${last.floorName}`,
        detail: `${floors} ${floors === 1 ? 'floor' : 'floors'} ${up ? 'up' : 'down'}${kind === 'elevator' ? ' · step-free' : ''}`,
        points: [pt(last)],
      });
      i = j;
    } else {
      // outdoor
      let j = i;
      const waypoints = [];
      let meters = 0;
      const pieces = [];
      while (j < hops.length && hops[j].edge.kind === 'outdoor') {
        const h = hops[j];
        pieces.push({ h, geo: h.edge.geo });
        meters += h.edge.meters;
        j++;
      }
      const endNode = g.nodes.get(hops[j - 1].to);
      const leavingBuilding = fromNode.kind === 'entrance';
      const arrivingBuilding = endNode.kind === 'entrance';
      if (leavingBuilding) {
        pushStep({
          kind: 'exit', scope: 'indoor', building: fromNode.buildingCode, level: 0, floorId: fromNode.floorId,
          text: `Exit ${fromNode.buildingName}`, detail: 'Through the main entrance onto the plaza',
          points: [pt(fromNode)],
        });
      }
      for (const p of pieces) {
        // stored geometry runs plaza -> entrance and gate -> plaza; flip when walking the other way
        const storedFirst = p.h.edge.forward; // true when traversal follows stored a->b
        const pts = (p.geo || []).map(([x, y]) => ({ x, y }));
        const ordered = storedFirst ? pts : [...pts].reverse();
        for (const q of ordered) {
          const lastW = waypoints[waypoints.length - 1];
          if (!lastW || lastW.x !== q.x || lastW.y !== q.y) waypoints.push(q);
        }
      }
      const target = arrivingBuilding ? endNode.buildingName : endNode.kind === 'plaza' ? 'the campus plaza' : 'the main gate';
      pushStep({
        kind: 'outdoor', scope: 'outdoor', building: null, level: null,
        meters: r1(meters), seconds: Math.round(meters / WALK_SPEED),
        text: `Walk across the campus to ${target}`,
        detail: `Follow the paved path · ${Math.round(meters)} m`,
        points: waypoints,
      });
      pushPath('outdoor', fromNode, waypoints);
      if (arrivingBuilding) {
        pushStep({
          kind: 'enter', scope: 'indoor', building: endNode.buildingCode, level: 0, floorId: endNode.floorId,
          text: `Enter ${endNode.buildingName}`, detail: 'Main entrance, Ground Floor', points: [pt(endNode)],
        });
      }
      i = j;
    }
  }

  const dest = to.hall || null;
  const finalStep = steps[steps.length - 1];
  pushStep({
    kind: 'arrive', scope: finalStep?.scope || 'indoor',
    building: to.node.buildingCode || null, level: to.node.level ?? null, floorId: to.node.floorId ?? null,
    text: `Arrive at ${to.label}`,
    detail: to.node.buildingName ? `${to.node.buildingName} · ${to.node.floorName}` : 'You have arrived',
    points: [pt(to.node)],
  });

  const distanceM = r1(steps.reduce((s, x) => s + x.meters, 0));
  const durationSec = steps.reduce((s, x) => s + x.seconds, 0);
  const floorsTouched = [...new Set(steps.filter((s) => s.floorId).map((s) => s.floorId))];
  return {
    from: { code: from.code, name: from.label, building: startNode.buildingCode || null, level: startNode.level ?? null, floorId: startNode.floorId ?? null, point: pt(startNode) },
    to: { code: to.code, name: to.label, building: to.node.buildingCode || null, level: to.node.level ?? null, floorId: to.node.floorId ?? null, point: pt(to.node) },
    accessible,
    distanceM,
    durationSec,
    usesStairs: steps.some((s) => s.kind.startsWith('stairs')),
    floorsTouched,
    steps,
    paths,
  };
}
