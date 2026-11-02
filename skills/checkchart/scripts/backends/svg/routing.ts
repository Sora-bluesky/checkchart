import type { Box, Point, PortSide, SvgNode } from "./scene.ts";

export type End = { point: Point; side: PortSide; node?: SvgNode; boundary?: Box };
const clearance = 12, jog = 16, leadLength = 24, portSpacing = 32;
const normal: Record<PortSide, Point> = { NORTH: { x: 0, y: -1 }, SOUTH: { x: 0, y: 1 }, EAST: { x: 1, y: 0 }, WEST: { x: -1, y: 0 } };
const vertical = (side: PortSide) => side === "NORTH" || side === "SOUTH";
const compact = (points: Point[]) => points.filter((p, i) => !i || distance(p, points[i - 1]) > 0.001)
  .filter((p, i, all) => !i || i === all.length - 1 ||
    !(all[i - 1].x === p.x && p.x === all[i + 1].x || all[i - 1].y === p.y && p.y === all[i + 1].y));

const crossesBox = (a: Point, b: Point, box: Box) =>
  Math.max(a.x, b.x) > box.x + 0.01 && Math.min(a.x, b.x) < box.x + box.width - 0.01 &&
  Math.max(a.y, b.y) > box.y + 0.01 && Math.min(a.y, b.y) < box.y + box.height - 0.01;
const distance = (a: Point, b: Point) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

// Route an unlabelled exit through the already measured content. A visibility
// grid supplies a shortest orthogonal detour when a sibling blocks a direct exit.
export function exitRoute(start: Point, end: Point, boxes: Box[], bounds: Box): Point[] | undefined {
  const clear = (a: Point, b: Point) => !boxes.some((box) => crossesBox(a, b, box));
  if ((start.x === end.x || start.y === end.y) && clear(start, end)) return [start, end];
  const xs = [...new Set([start.x, end.x, bounds.x, bounds.x + bounds.width,
    ...boxes.flatMap((box) => [box.x - 8, box.x + box.width + 8])])]
    .filter((x) => x >= bounds.x && x <= bounds.x + bounds.width).sort((a, b) => a - b);
  const ys = [...new Set([start.y, end.y, bounds.y, bounds.y + bounds.height,
    ...boxes.flatMap((box) => [box.y - 8, box.y + box.height + 8])])]
    .filter((y) => y >= bounds.y && y <= bounds.y + bounds.height).sort((a, b) => a - b);
  const point = (id: number) => ({ x: xs[id % xs.length], y: ys[Math.floor(id / xs.length)] });
  const idOf = (p: Point) => ys.indexOf(p.y) * xs.length + xs.indexOf(p.x);
  const first = idOf(start), last = idOf(end);
  if (!xs.includes(start.x) || !xs.includes(end.x) || !ys.includes(start.y) || !ys.includes(end.y)) return;
  const costs = new Map([[first, 0]]), previous = new Map<number, number>(), pending = new Set([first]);
  while (pending.size) {
    let current = -1, best = Infinity;
    for (const id of pending) {
      const cost = costs.get(id)! + distance(point(id), end);
      if (cost < best) { best = cost; current = id; }
    }
    if (current === last) break;
    pending.delete(current);
    const x = current % xs.length, y = Math.floor(current / xs.length);
    const neighbors = [x > 0 ? current - 1 : -1, x + 1 < xs.length ? current + 1 : -1,
      y > 0 ? current - xs.length : -1, y + 1 < ys.length ? current + xs.length : -1];
    for (const next of neighbors) if (next >= 0 && clear(point(current), point(next))) {
      const cost = costs.get(current)! + distance(point(current), point(next));
      if (cost < (costs.get(next) ?? Infinity)) {
        costs.set(next, cost); previous.set(next, current); pending.add(next);
      }
    }
  }
  if (!costs.has(last)) return;
  const path: Point[] = [];
  for (let id: number | undefined = last; id !== undefined; id = previous.get(id)) path.unshift(point(id));
  return path.filter((p, i) => !i || i === path.length - 1 ||
    !((path[i - 1].x === p.x && p.x === path[i + 1].x) || (path[i - 1].y === p.y && p.y === path[i + 1].y)));
}

// A visibility graph whose arcs run from bend to bend. Requiring a full jog
// before each turn avoids the tiny grid steps a point-only shortest path allows.
export function orthogonalRoute(start: End, end: End, boxes: Box[], bounds: Box, occupied: [Point, Point][], forbidden: [Point, Point][] = [],
  goals = { padding: clearance, maxDetour: Infinity }): Point[] | undefined {
  const { padding, maxDetour } = goals;
  const minimumJog = jog, normalLead = leadLength;
  const shared = (a: Point, b: Point) => occupied.reduce((total, [p, q]) => {
    const v = a.x === b.x;
    if (v !== (p.x === q.x) || Math.abs(v ? a.x - p.x : a.y - p.y) >= 0.01) return total;
    const overlap = v ? Math.min(Math.max(a.y, b.y), Math.max(p.y, q.y)) - Math.max(Math.min(a.y, b.y), Math.min(p.y, q.y))
      : Math.min(Math.max(a.x, b.x), Math.max(p.x, q.x)) - Math.max(Math.min(a.x, b.x), Math.min(p.x, q.x));
    return total + Math.max(0, overlap);
  }, 0);
  const crosses = (a: Point, b: Point, p: Point, q: Point) => {
    if ((a.x === b.x) === (p.x === q.x)) return false;
    const v = a.x === b.x ? [a, b] : [p, q], h = a.x === b.x ? [p, q] : [a, b];
    return v[0].x >= Math.min(h[0].x, h[1].x) - 0.01 && v[0].x <= Math.max(h[0].x, h[1].x) + 0.01 &&
      h[0].y >= Math.min(v[0].y, v[1].y) - 0.01 && h[0].y <= Math.max(v[0].y, v[1].y) + 0.01;
  };
  const clear = (a: Point, b: Point) => !boxes.some((box) => crossesBox(a, b, box)) && !forbidden.some(([p, q]) => crosses(a, b, p, q));
  const n = normal[start.side], m = normal[end.side];
  const aligned = (a: Point, b: Point, v: Point) => v.x ? a.y === b.y && (b.x - a.x) * v.x > 0 : a.x === b.x && (b.y - a.y) * v.y > 0;
  // Endpoint boxes are excluded from the direct segment only; all searched
  // bends stay outside their inflated rectangles.
  if (aligned(start.point, end.point, n) && aligned(end.point, start.point, m)) {
    const middleA = { x: start.point.x + n.x * 0.01, y: start.point.y + n.y * 0.01 };
    const middleB = { x: end.point.x + m.x * 0.01, y: end.point.y + m.y * 0.01 };
    const endpointBoxes = new Set([start.node?.box, end.node?.box, start.boundary, end.boundary]);
    if (!forbidden.some(([p, q]) => crosses(start.point, end.point, p, q)) && shared(start.point, end.point) < 0.01 && !boxes.some((box) => ![...endpointBoxes].some((own) => own &&
      Math.abs(box.x - own.x + padding) < 0.01 && Math.abs(box.y - own.y + padding) < 0.01 &&
      Math.abs(box.width - own.width - padding * 2) < 0.01 && Math.abs(box.height - own.height - padding * 2) < 0.01) && crossesBox(middleA, middleB, box))) return [start.point, end.point];
  }
  if (vertical(start.side) !== vertical(end.side)) {
    const corner = vertical(start.side) ? { x: start.point.x, y: end.point.y } : { x: end.point.x, y: start.point.y };
    const own = [start.node?.box, end.node?.box];
    const obstacles = boxes.filter((box) => !own.some((node) => node && Math.abs(box.x - node.x + padding) < 0.01 &&
      Math.abs(box.y - node.y + padding) < 0.01 && Math.abs(box.width - node.width - padding * 2) < 0.01 &&
      Math.abs(box.height - node.height - padding * 2) < 0.01));
    if (aligned(start.point, corner, n) && aligned(end.point, corner, m) && distance(start.point, corner) >= normalLead && distance(end.point, corner) >= normalLead &&
      !obstacles.some((box) => crossesBox(start.point, corner, box) || crossesBox(corner, end.point, box)) &&
      !forbidden.some(([p, q]) => crosses(start.point, corner, p, q) || crosses(corner, end.point, p, q))) return [start.point, corner, end.point];
  }
  const lead = (e: End) => {
    const v = normal[e.side], box = e.node?.box;
    const p = { x: e.point.x + v.x * normalLead, y: e.point.y + v.y * normalLead };
    if (box) {
      if (v.x) p.x = (v.x < 0 ? box.x : box.x + box.width) + v.x * normalLead;
      if (v.y) p.y = (v.y < 0 ? box.y : box.y + box.height) + v.y * normalLead;
    }
    return p;
  };
  const a = lead(start), b = lead(end);
  const xs = [...new Set([a.x, b.x, (a.x + b.x) / 2, bounds.x, bounds.x + bounds.width,
    ...[a.x, b.x].flatMap((x) => [x - jog, x + jog]), ...occupied.flatMap(([p, q]) => p.x === q.x ? [p.x - portSpacing, p.x + portSpacing] : []),
    ...boxes.flatMap((box) => [box.x, box.x + box.width])])]
    .filter((x) => x >= bounds.x - 0.001 && x <= bounds.x + bounds.width + 0.001).sort((a, b) => a - b);
  const ys = [...new Set([a.y, b.y, (a.y + b.y) / 2, bounds.y, bounds.y + bounds.height,
    ...[a.y, b.y].flatMap((y) => [y - jog, y + jog]), ...occupied.flatMap(([p, q]) => p.y === q.y ? [p.y - portSpacing, p.y + portSpacing] : []),
    ...boxes.flatMap((box) => [box.y, box.y + box.height])])]
    .filter((y) => y >= bounds.y - 0.001 && y <= bounds.y + bounds.height + 0.001).sort((a, b) => a - b);
  const point = (id: number): Point => ({ x: xs[id % xs.length], y: ys[Math.floor(id / xs.length)] });
  const idOf = (p: Point) => ys.indexOf(p.y) * xs.length + xs.indexOf(p.x);
  if (!xs.includes(a.x) || !xs.includes(b.x) || !ys.includes(a.y) || !ys.includes(b.y)) return;
  const first = idOf(a) * 3, last = idOf(b), pending = new Set([first]);
  const costs = new Map([[first, { bends: 0, shared: 0, length: 0 }]]), previous = new Map<number, number>();
  const unreachable = { bends: Infinity, shared: Infinity, length: Infinity };
  const better = (a: typeof unreachable, b: typeof unreachable) => a.bends < b.bends ||
    a.bends === b.bends && a.length + a.shared * 2 < b.length + b.shared * 2 - 0.01;
  let finish: number | undefined;
  while (pending.size) {
    let current = -1, best = unreachable;
    for (const state of pending) {
      const saved = costs.get(state)!;
      const cost = { ...saved, length: saved.length + distance(point(Math.floor(state / 3)), b) };
      if (better(cost, best)) { best = cost; current = state; }
    }
    const id = Math.floor(current / 3), incoming = current % 3, p = point(id);
    if (id === last) { finish = current; break; }
    pending.delete(current);
    const x = id % xs.length, y = Math.floor(id / xs.length);
    const neighbors = [...xs.map((_, i) => y * xs.length + i), ...ys.map((_, i) => i * xs.length + x)];
    for (const next of neighbors) {
      const q = point(next), length = distance(p, q), axis = p.x === q.x ? 2 : 1;
      const joinsLead = current === first && axis === (n.x ? 1 : 2) || next === last && axis === (m.x ? 1 : 2);
      if (length < 0.001 || length < minimumJog - 0.001 && !joinsLead || incoming === axis || !clear(p, q)) continue;
      if (current === first && (q.x - p.x) * n.x + (q.y - p.y) * n.y < 0) continue;
      if (next === last && (p.x - q.x) * m.x + (p.y - q.y) * m.y < 0) continue;
      const state = next * 3 + axis, saved = costs.get(current)!;
      const extension = current === first && (n.x ? axis === 1 : axis === 2) ? length * 0.01 : 0;
      const turn = incoming || axis !== (n.x ? 1 : 2) ? 1 : 0;
      const arrival = next === last && axis !== (m.x ? 1 : 2) ? 1 : 0;
      const cost = { bends: saved.bends + turn + arrival, shared: saved.shared + shared(p, q), length: saved.length + length + extension };
      if (better(cost, costs.get(state) ?? unreachable)) { costs.set(state, cost); previous.set(state, current); pending.add(state); }
    }
  }
  if (finish === undefined) return;
  const points: Point[] = [];
  for (let state: number | undefined = finish; state !== undefined; state = previous.get(state)) points.unshift(point(Math.floor(state / 3)));
  const route = compact([start.point, ...points, end.point]);
  const length = route.slice(1).reduce((sum, p, i) => sum + distance(route[i], p), 0);
  if (route.length > 2 && route.slice(1).some((p, i) => distance(route[i], p) < jog - 0.01)) return;
  return length <= distance(start.point, end.point) * maxDetour + 0.01 || !Number.isFinite(maxDetour) ? route : undefined;
}
