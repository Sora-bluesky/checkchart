import type { Direction } from "../../ir.ts";
import { layoutCompromise, onOutline, overlaps, tabBox, type Box, type Container, type Point, type PortSide, type Scene, type SvgEdge, type SvgNode } from "./scene.ts";
import { segmentCrossesBox } from "./obstacles.ts";
import { placeEdgeLabels } from "./labels.ts";
import { exitRoute, orthogonalRoute, type End } from "./routing.ts";

const clearance = 12, jog = 16, leadLength = 24, portSpacing = 32;
const center = (box: Box): Point => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 });
const normal: Record<PortSide, Point> = { NORTH: { x: 0, y: -1 }, SOUTH: { x: 0, y: 1 }, EAST: { x: 1, y: 0 }, WEST: { x: -1, y: 0 } };
const opposite: Record<PortSide, PortSide> = { NORTH: "SOUTH", SOUTH: "NORTH", EAST: "WEST", WEST: "EAST" };
const vertical = (side: PortSide) => side === "NORTH" || side === "SOUTH";
const distance = (a: Point, b: Point) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
const same = (a: Point, b: Point) => distance(a, b) < 0.001;
const inflate = (box: Box, by: number): Box => ({ x: box.x - by, y: box.y - by, width: box.width + by * 2, height: box.height + by * 2 });
const clamp = (n: number, low: number, high: number) => Math.max(low, Math.min(high, n));
const compact = (points: Point[]) => points.filter((p, i) => !i || !same(p, points[i - 1]))
  .filter((p, i, all) => !i || i === all.length - 1 ||
    !(all[i - 1].x === p.x && p.x === all[i + 1].x || all[i - 1].y === p.y && p.y === all[i + 1].y));
const intersects = (a: Point, b: Point, p: Point, q: Point) => {
  if ((a.x === b.x) === (p.x === q.x)) return false;
  const v = a.x === b.x ? [a, b] : [p, q], h = a.x === b.x ? [p, q] : [a, b];
  return v[0].x >= Math.min(h[0].x, h[1].x) - 0.01 && v[0].x <= Math.max(h[0].x, h[1].x) + 0.01 &&
    h[0].y >= Math.min(v[0].y, v[1].y) - 0.01 && h[0].y <= Math.max(v[0].y, v[1].y) + 0.01;
};

export function facingSide(a: Box, b: Box, direction: Direction): PortSide {
  const xSeparate = a.x + a.width <= b.x || b.x + b.width <= a.x;
  const ySeparate = a.y + a.height <= b.y || b.y + b.height <= a.y;
  const horizontal = direction === "LR" || direction === "RL";
  const useVertical = horizontal ? !xSeparate && ySeparate : ySeparate || !xSeparate;
  return useVertical ? center(b).y > center(a).y ? "SOUTH" : "NORTH" : center(b).x > center(a).x ? "EAST" : "WEST";
}

export function edgePairs(edges: SvgEdge[]): SvgEdge[][] {
  const pairs = new Map<string, SvgEdge[]>();
  for (const edge of edges) if (edge.source !== edge.target) {
    const key = [edge.source, edge.target].sort().join(" ");
    pairs.set(key, [...pairs.get(key) ?? [], edge]);
  }
  return [...pairs.values()].filter((pair) => pair.length > 1);
}

// Move the child of the common ancestor as one unit, preserving every nested
// containment relation. Paired exchanges take precedence over a layout bend.
function alignPairs(scene: Scene, direction: Direction) {
  const parent = new Map([...scene.nodes, ...scene.containers].map((item) => [item.id, item.parent ?? "root"]));
  const items = new Map([...scene.nodes, ...scene.containers].map((item) => [item.id, item]));
  const chain = (id: string) => {
    const ids = [id];
    for (let p = parent.get(id); p !== undefined && p !== "root"; p = parent.get(p)) ids.push(p);
    return [...ids, "root"];
  };
  const shift = (id: string, axis: "x" | "y", delta: number) => {
    if (Math.abs(delta) < 0.001) return;
    for (const [key, item] of items) if (chain(key).includes(id)) item.box[axis] += delta;
  };
  for (const pair of edgePairs(scene.edges)) {
    const a = scene.nodes.find((node) => node.id === pair[0].source)!, b = scene.nodes.find((node) => node.id === pair[0].target)!;
    const side = facingSide(a.box, b.box, direction), axis = vertical(side) ? "x" : "y";
    const ac = chain(a.id), bc = chain(b.id), common = ac.slice(1).find((id) => bc.slice(1).includes(id))!;
    let fixed = a, moving = b, movingChain = bc;
    // An outside leaf follows the position of an inside leaf, rather than
    // sliding the inside content under its tab or out of its enclosing zone.
    if (ac.indexOf(common) === 1 && bc.indexOf(common) > 1) { fixed = b; moving = a; movingChain = ac; }
    const assigned = nodePorts(scene, direction);
    const offset = pair.reduce((sum, edge) => {
      const aPort = assigned.get(`${edge.id} ${edge.source === a.id ? "source" : "target"}`)!;
      const bPort = assigned.get(`${edge.id} ${edge.source === b.id ? "source" : "target"}`)!;
      return sum + aPort.point[axis] - bPort.point[axis];
    }, 0) / pair.length;
    const unit = movingChain[movingChain.indexOf(common) - 1];
    shift(unit, axis, moving === b ? offset : -offset);
    const anchor = items.get(unit)!;
    const siblings = [...items.values()].filter((item) => parent.get(item.id) === common && item.id !== unit && !chain(fixed.id).includes(item.id));
    for (const sibling of siblings.sort((a, b) => a.box[axis] - b.box[axis])) if (overlaps(anchor.box, sibling.box, clearance)) {
      const extent = axis === "x" ? "width" : "height";
      shift(sibling.id, axis, anchor.box[axis] + anchor.box[extent] + 40 - sibling.box[axis]);
    }
  }
  for (const pair of edgePairs(scene.edges)) {
    const assigned = nodePorts(scene, direction), a = assigned.get(`${pair[0].id} source`)!, b = assigned.get(`${pair[0].id} target`)!;
    const axis = vertical(a.side) ? "x" : "y", extent = axis === "x" ? "width" : "height";
    const axes = pair.map((edge) => assigned.get(`${edge.id} ${edge.source === pair[0].source ? "source" : "target"}`)!.point[axis]);
    const low = Math.min(...axes), high = Math.max(...axes);
    const corridor = axis === "x" ? { x: low - clearance, y: Math.min(a.point.y, b.point.y), width: high - low + clearance * 2, height: Math.abs(a.point.y - b.point.y) }
      : { x: Math.min(a.point.x, b.point.x), y: low - clearance, width: Math.abs(a.point.x - b.point.x), height: high - low + clearance * 2 };
    const fixed = new Set([...chain(a.node!.id), ...chain(b.node!.id)]);
    for (const item of items.values()) {
      if (fixed.has(item.id) || !fixed.has(parent.get(item.id) ?? "root") || !overlaps(item.box, corridor)) continue;
      shift(item.id, axis, high + 40 - item.box[axis]);
      for (const id of chain(item.id).slice(1)) {
        const zone = scene.containers.find((zone) => zone.id === id);
        if (zone) zone.box[extent] = Math.max(zone.box[extent], item.box[axis] + item.box[extent] + 40 - zone.box[axis]);
      }
    }
  }
}

type RoutePart = { owner: string; start: End; end: End; path?: Point[] };
type Attachment = { edge: SvgEdge; end: "source" | "target"; other: SvgNode; node: SvgNode; side: PortSide; fixed?: number };

function facePoint(node: SvgNode, side: PortSide, axis = center(node.box)[vertical(side) ? "x" : "y"]): Point {
  const box = node.box, n = normal[side];
  const point = vertical(side) ? { x: axis, y: side === "NORTH" ? box.y : box.y + box.height }
    : { x: side === "WEST" ? box.x : box.x + box.width, y: axis };
  return onOutline(node, point, { x: point.x + n.x * leadLength, y: point.y + n.y * leadLength });
}

function decisionLoopPaths(node: SvgNode, side: PortSide): Point[][] {
  const p = facePoint(node, side), n = normal[side];
  const q = (along: number, across: number) => ({ x: p.x + n.x * along - n.y * across, y: p.y + n.y * along + n.x * across });
  return [-1, 1].map((sign) => [p, q(48, 0), q(48, sign * 60), q(24, sign * 60), q(24, 0), p]);
}

function loopObstructions(scene: Scene, node: SvgNode, path: Point[]) {
  const boxes = portObstacles(scene, node, node);
  const region = scene.containers.find((zone) => zone.id === node.parent)?.box;
  return path.slice(1).filter((q, i) => boxes.some((box) => segmentCrossesBox(path[i], q, box))).length +
    (region ? path.filter((p) => p.x < region.x + clearance || p.y < region.y + clearance ||
      p.x > region.x + region.width - clearance || p.y > region.y + region.height - clearance).length : 0);
}

const outward = (a: Point, b: Point, side: PortSide) => {
  const n = normal[side];
  return (n.x ? a.y === b.y : a.x === b.x) && (b.x - a.x) * n.x + (b.y - a.y) * n.y > 0;
};

function portObstacles(scene: Scene, a: SvgNode, b: SvgNode, includeTabs = true): Box[] {
  const ancestors = new Set<string>();
  for (const node of [a, b]) for (let p = node.parent; p && p !== "root"; p = scene.containers.find((zone) => zone.id === p)?.parent) ancestors.add(p);
  return [...scene.nodes.filter((node) => node !== a && node !== b).map((node) => inflate(node.box, clearance)),
    ...scene.containers.filter((zone) => !ancestors.has(zone.id)).map((zone) => inflate(zone.box, clearance)),
    ...(includeTabs ? scene.containers.map((zone) => inflate(tabBox(zone), 4)) : []), ...scene.notes.map((note) => inflate(note.box, 4))];
}

function clearsZonePorts(path: Point[], zones: Container[]): boolean {
  for (let i = 1; i < path.length; i++) for (const zone of zones) {
    const a = path[i - 1], b = path[i], box = zone.box, tab = tabBox(zone);
    if (a.x === b.x && a.x > box.x && a.x < box.x + box.width &&
      box.y >= Math.min(a.y, b.y) && box.y <= Math.max(a.y, b.y) && a.x < tab.x + tab.width + jog - 0.001) return false;
    if (a.y === b.y && a.y > box.y && a.y < box.y + box.height &&
      [box.x, box.x + box.width].some((x) => x >= Math.min(a.x, b.x) && x <= Math.max(a.x, b.x)) &&
      a.y < tab.y + tab.height + jog - 0.001) return false;
  }
  return true;
}

function straightAxis(a: Attachment, b: Attachment, boxes: Box[], accepts = (_value: number, _centered: boolean) => true): number | undefined {
  if (a.side !== opposite[b.side]) return;
  const axis = vertical(a.side) ? "x" : "y", extent = vertical(a.side) ? "width" : "height";
  const low = Math.max(a.node.box[axis], b.node.box[axis]);
  const high = Math.min(a.node.box[axis] + a.node.box[extent], b.node.box[axis] + b.node.box[extent]);
  if (high - low < jog - 0.001) return;
  const diamonds = [a.node, b.node].filter((node) => node.shape === "decision");
  const value = diamonds.length ? center(diamonds[0].box)[axis] : (low + high) / 2;
  if (value < low || value > high || diamonds.some((node) => Math.abs(center(node.box)[axis] - value) > 0.001)) return;
  const safeLow = Math.max(a.node.box[axis], b.node.box[axis]) + jog;
  const safeHigh = Math.min(a.node.box[axis] + a.node.box[extent], b.node.box[axis] + b.node.box[extent]) - jog;
  const alternatives = diamonds.length ? [] : [...new Set([safeLow, safeHigh,
    ...boxes.flatMap((box) => [box[axis], box[axis] + box[extent]])])]
    .filter((candidate) => candidate >= safeLow && candidate <= safeHigh)
    .sort((x, y) => Math.abs(x - value) - Math.abs(y - value) || x - y);
  for (const candidate of [value, ...alternatives]) {
    const p = facePoint(a.node, a.side, candidate), q = facePoint(b.node, b.side, candidate);
    if (outward(p, q, a.side) && outward(q, p, b.side) && !boxes.some((box) => segmentCrossesBox(p, q, box)) && accepts(candidate, candidate === value)) return candidate;
  }
}

// An off-center north entry must reserve tab space before routing or zone
// tightening. Extend only an endpoint ancestor into clear space; keep its
// contents fixed and retain the normal 16px gap after the tab.
function reserveStraightTabSpace(scene: Scene, direction: Direction) {
  const paired = new Set(edgePairs(scene.edges).flat());
  for (const edge of scene.edges) {
    const source = scene.nodes.find((node) => node.id === edge.source), target = scene.nodes.find((node) => node.id === edge.target);
    if (!source || !target || source === target || paired.has(edge)) continue;
    const a: Attachment = { edge, end: "source", node: source, other: target, side: escapeSide(scene, source, target, direction) };
    const b: Attachment = { edge, end: "target", node: target, other: source, side: facingSide(target.box, source.box, direction) };
    if (!vertical(a.side) || straightAxis(a, b, portObstacles(scene, source, target),
      (value) => clearsZonePorts([facePoint(source, a.side, value), facePoint(target, b.side, value)], scene.containers)) !== undefined) continue;
    const ancestors = new Set<string>();
    for (const node of [source, target]) for (let p = node.parent; p && p !== "root"; p = scene.containers.find((zone) => zone.id === p)?.parent) ancestors.add(p);
    const changes = new Map<Container, Box>();
    const axis = straightAxis(a, b, portObstacles(scene, source, target, false), (value) => {
      changes.clear();
      const p = facePoint(source, a.side, value), q = facePoint(target, b.side, value);
      for (const zone of scene.containers) {
        if (!segmentCrossesBox(p, q, inflate(tabBox(zone), 4)) && clearsZonePorts([p, q], [zone])) continue;
        if (!ancestors.has(zone.id)) return false;
        const x = value - tabBox(zone).width - jog;
        const box = { ...zone.box, x, width: zone.box.x + zone.box.width - x };
        const parent = scene.containers.find((parent) => parent.id === zone.parent);
        if (x >= zone.box.x || parent && (x < parent.box.x + clearance || box.y < parent.box.y + clearance ||
          box.x + box.width > parent.box.x + parent.box.width - clearance || box.y + box.height > parent.box.y + parent.box.height - clearance) ||
          [...scene.nodes, ...scene.containers].some((peer) => peer !== zone && (peer.parent ?? "root") === (zone.parent ?? "root") && overlaps(box, peer.box, clearance))) return false;
        changes.set(zone, box);
      }
      return changes.size > 0;
    });
    if (axis !== undefined) for (const [zone, box] of changes) zone.box = box;
  }
}

// Reserve the complete parallel envelope too. Clamping just its first boundary
// port to the tab margin would displace an otherwise free straight lane.
function reservePairedTabSpace(scene: Scene, direction: Direction) {
  if (!edgePairs(scene.edges).length) return;
  const ports = nodePorts(scene, direction);
  for (const edge of edgePairs(scene.edges).flat()) {
    const start = ports.get(`${edge.id} source`)!, end = ports.get(`${edge.id} target`)!;
    if (start.side !== opposite[end.side] || !outward(start.point, end.point, start.side) ||
      !outward(end.point, start.point, end.side) ||
      portObstacles(scene, start.node!, end.node!, false).some((box) => segmentCrossesBox(start.point, end.point, box))) continue;
    const ancestors = new Set<string>();
    for (const node of [start.node!, end.node!]) for (let p = node.parent; p && p !== "root"; p = scene.containers.find((zone) => zone.id === p)?.parent) ancestors.add(p);
    for (const zone of scene.containers) {
      if (!ancestors.has(zone.id) || clearsZonePorts([start.point, end.point], [zone])) continue;
      const v = vertical(start.side), axis = v ? "x" : "y", extent = v ? "width" : "height", tab = tabBox(zone);
      const value = start.point[axis] - (v ? tab.width : tab.height) - jog;
      if (value >= zone.box[axis]) continue;
      const box = { ...zone.box, [axis]: value, [extent]: zone.box[axis] + zone.box[extent] - value };
      const parent = scene.containers.find((parent) => parent.id === zone.parent);
      if (parent && (box.x < parent.box.x + clearance || box.y < parent.box.y + clearance ||
        box.x + box.width > parent.box.x + parent.box.width - clearance || box.y + box.height > parent.box.y + parent.box.height - clearance) ||
        [...scene.nodes, ...scene.containers].some((peer) => peer !== zone && (peer.parent ?? "root") === (zone.parent ?? "root") && overlaps(box, peer.box, clearance))) continue;
      zone.box = box;
    }
  }
}

// Resolve a complete minimum-bend path before choosing individual zone ports.
// A two-bend stair needs the same shared border lanes as a straight line or L.
function minimumPath(scene: Scene, start: End, end: End): Point[] | undefined {
  if (!start.node || !end.node || start.node === end.node) return;
  const a = start.point, b = end.point;
  const direct = outward(a, b, start.side) && outward(b, a, end.side) ? [a, b]
    : vertical(start.side) !== vertical(end.side)
      ? [a, vertical(start.side) ? { x: a.x, y: b.y } : { x: b.x, y: a.y }, b] : undefined;
  const boxes = portObstacles(scene, start.node, end.node);
  const axis = vertical(start.side) ? "y" : "x", extent = axis === "x" ? "width" : "height";
  const middles = [...new Set([a[axis] + normal[start.side][axis] * leadLength, b[axis] + normal[end.side][axis] * leadLength,
    (a[axis] + b[axis]) / 2, ...boxes.flatMap((box) => [box[axis], box[axis] + box[extent]])])];
  const paths = direct ? [direct] : end.side === opposite[start.side] ? middles.map((mid) =>
    [a, { ...a, [axis]: mid }, { ...b, [axis]: mid }, b]) : [];
  for (const path of paths) {
    if (!outward(a, path[1], start.side) || !outward(b, path.at(-2)!, end.side) || !clearsZonePorts(path, scene.containers)) continue;
    if (path.length > 2 && (distance(a, path[1]) < leadLength || distance(b, path.at(-2)!) < leadLength ||
      path.slice(2, -1).some((p, i) => distance(path[i + 1], p) < jog))) continue;
    const blocked = path.slice(1).some((q, i) => {
      const p = path[i], v = p.x === q.x;
      return boxes.some((box) => segmentCrossesBox(p, q, box)) || scene.containers.some(({ box }) => {
        const low = v ? Math.min(p.y, q.y) : Math.min(p.x, q.x), high = v ? Math.max(p.y, q.y) : Math.max(p.x, q.x);
        const overlap = Math.min(high, v ? box.y + box.height : box.x + box.width) - Math.max(low, v ? box.y : box.x);
        return overlap > 0.001 && (v ? [box.x, box.x + box.width] : [box.y, box.y + box.height])
          .some((value) => Math.abs((v ? p.x : p.y) - value) < clearance - 0.001);
      });
    });
    if (!blocked) return path;
  }
}

function simplePlan(scene: Scene, start: End, end: End, edge: string): RoutePart[] | undefined {
  const path = minimumPath(scene, start, end);
  if (!path) return;
  const a = path[0];
  const parts: RoutePart[] = [], crossings: { zone: Container; point: Point; side: PortSide; incoming: boolean }[] = [];
  const inside = (p: Point, box: Box) => p.x > box.x && p.y > box.y && p.x < box.x + box.width && p.y < box.y + box.height;
  const owner = (points: Point[]) => scene.containers.filter((zone) => inside({ x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 }, zone.box))
    .sort((a, b) => a.box.width * a.box.height - b.box.width * b.box.height)[0]?.id ?? "root";
  let section = [a], first = start;
  for (let i = 1; i < path.length; i++) {
    const p = path[i - 1], q = path[i], v = p.x === q.x;
    const hits = scene.containers.flatMap((zone) => {
      const box = zone.box;
      if (v ? p.x <= box.x || p.x >= box.x + box.width : p.y <= box.y || p.y >= box.y + box.height) return [];
      return (v ? [box.y, box.y + box.height] : [box.x, box.x + box.width]).flatMap((value, index) => {
        const point = v ? { x: p.x, y: value } : { x: value, y: p.y };
        if (distance(p, point) < 0.001 || distance(p, point) >= distance(p, q) - 0.001 || (v ? (value - p.y) * (q.y - p.y) : (value - p.x) * (q.x - p.x)) <= 0) return [];
        const side: PortSide = v ? index ? "SOUTH" : "NORTH" : index ? "EAST" : "WEST";
        return [{ zone, point, side, incoming: (q.x - p.x) * normal[side].x + (q.y - p.y) * normal[side].y < 0 }];
      });
    }).sort((x, y) => distance(p, x.point) - distance(p, y.point));
    for (const hit of hits) {
      section.push(hit.point);
      parts.push({ owner: owner(section), start: first, end: { point: hit.point, boundary: hit.zone.box,
        side: hit.incoming ? hit.side : opposite[hit.side] }, path: section });
      first = { point: hit.point, boundary: hit.zone.box, side: hit.incoming ? opposite[hit.side] : hit.side };
      section = [hit.point]; crossings.push(hit);
    }
    section.push(q);
  }
  if (new Set(crossings.map((hit) => hit.zone.id)).size !== crossings.length) return;
  parts.push({ owner: owner(section), start: first, end, path: section });
  for (const hit of crossings) hit.zone.ports!.push({ id: `${edge}-${hit.zone.id}`, edge, point: hit.point, side: hit.side, incoming: hit.incoming });
  return parts;
}

function zoneEnd(zone: Container, inner: End, side: PortSide): End {
  const box = zone.box, tab = tabBox(zone);
  const point = vertical(side) ? { x: clamp(inner.point.x, box.x + jog, box.x + box.width - jog), y: side === "NORTH" ? box.y : box.y + box.height }
    : { x: side === "WEST" ? box.x : box.x + box.width, y: clamp(inner.point.y, tab.y + tab.height + jog, box.y + box.height - jog) };
  if (side === "NORTH") point.x = Math.max(point.x, tab.x + tab.width + jog);
  return { point, side, boundary: box };
}

// The node face and the zone exit are independent. A bottom port can turn
// toward an adjacent side border instead of travelling past a sibling below.
function escapeEnd(scene: Scene, zone: Container, start: End, other: SvgNode, direction: Direction, target = center(other.box)): End {
  const c = center(zone.box), preferred = facingSide(zone.box, other.box, direction);
  const ancestors = new Set<string>();
  for (let id: string | undefined = zone.id; id; id = scene.containers.find((zone) => zone.id === id)?.parent) ancestors.add(id);
  const boxes = [...scene.nodes.map((node) => inflate(node.box, clearance)),
    ...scene.containers.filter((zone) => !ancestors.has(zone.id)).map((zone) => inflate(zone.box, clearance)),
    ...scene.containers.map((zone) => inflate(tabBox(zone), 4)), ...scene.notes.map((note) => inflate(note.box, 4))];
  let best = Infinity, result: End | undefined;
  // Project the destination onto each border. Keeping the node's coordinate
  // would force a detour past a sibling and then back underneath that sibling.
  const n = normal[start.side];
  const anchors = [target, { x: start.point.x + n.x * leadLength, y: start.point.y + n.y * leadLength }];
  for (const side of [preferred, ...Object.keys(normal).filter((side) => side !== preferred)] as PortSide[]) {
    const m = normal[side];
    if ((target.x - c.x) * m.x + (target.y - c.y) * m.y <= 0) continue;
    for (const point of anchors) {
      const end = zoneEnd(zone, { ...start, point }, side);
      const points = orthogonalRoute(start, { ...end, side: opposite[side] }, boxes, inflate(zone.box, -clearance), []);
      if (!points) continue;
      const cost = points.slice(1).reduce((sum, point, i) => sum + distance(points[i], point), 0) + distance(end.point, target);
      if (cost < best - 0.01) { best = cost; result = end; }
    }
  }
  return result ?? zoneEnd(zone, start, preferred);
}

// Preserve the reading face whenever geometry permits an escape. A sibling
// may require a detour; another edge sharing the face is never an obstacle.
function escapeSide(scene: Scene, node: SvgNode, other: SvgNode, direction: Direction): PortSide {
  const preferred = facingSide(node.box, other.box, direction);
  const c = center(node.box), target = center(other.box);
  const boxes = [...scene.nodes.filter((item) => item !== other).map((item) => item.box),
    ...scene.containers.map(tabBox), ...scene.notes.map((note) => note.box)];
  const bounds = { x: -clearance, y: -clearance, width: scene.width + clearance * 2, height: scene.height + clearance * 2 };
  for (const side of [preferred, ...Object.keys(normal).filter((side) => side !== preferred)] as PortSide[]) {
    const n = normal[side];
    if ((target.x - c.x) * n.x + (target.y - c.y) * n.y <= 0) continue;
    const axis = vertical(side) ? "x" : "y", extent = vertical(side) ? "width" : "height";
    const slots = [...new Set([c[axis], node.box[axis], node.box[axis] + node.box[extent],
      ...boxes.flatMap((box) => [box[axis], box[axis] + box[extent]])])]
      .filter((value) => value >= node.box[axis] && value <= node.box[axis] + node.box[extent]);
    for (const value of slots) {
      const p = vertical(side) ? { x: value, y: side === "NORTH" ? node.box.y : node.box.y + node.box.height }
        : { x: side === "WEST" ? node.box.x : node.box.x + node.box.width, y: value };
      const start = { x: p.x + n.x * 0.04, y: p.y + n.y * 0.04 };
      if (boxes.some((box) => segmentCrossesBox(p, start, box))) continue;
      if (exitRoute(start, target, boxes, bounds)) return side;
    }
  }
  return preferred;
}

function nodePorts(scene: Scene, direction: Direction, deferred = new Set<SvgEdge>(), straight = new Map<SvgEdge, number>()): Map<string, End> {
  const attachments: Attachment[] = [];
  const paired = new Set(edgePairs(scene.edges).flat());
  for (const edge of scene.edges) {
    const source = scene.nodes.find((node) => node.id === edge.source), target = scene.nodes.find((node) => node.id === edge.target);
    if (!source || !target) continue;
    attachments.push({ edge, end: "source", node: source, other: target, side: source === target ? "EAST" : escapeSide(scene, source, target, direction) },
      { edge, end: "target", node: target, other: source, side: source === target ? "EAST" : facingSide(target.box, source.box, direction) });
  }
  for (let i = 0; i < attachments.length; i += 2) {
    const a = attachments[i], b = attachments[i + 1], axis = straight.get(a.edge);
    if (axis !== undefined) a.fixed = b.fixed = axis;
  }
  // Reserve a shared straight axis before any face is spread. Both ends own
  // the same reservation, including incoming edges and cross-zone edges.
  const reserveStraight = () => {
    for (let i = 0; i < attachments.length; i += 2) {
      const a = attachments[i], b = attachments[i + 1];
      if (a.fixed !== undefined || paired.has(a.edge) || a.node === b.node) continue;
      const axis = straightAxis(a, b, portObstacles(scene, a.node, b.node), (value, centered) =>
        clearsZonePorts([facePoint(a.node, a.side, value), facePoint(b.node, b.side, value)], scene.containers) && (centered || [a, b].every((item) => {
          const axis = vertical(item.side) ? "x" : "y", extent = vertical(item.side) ? "width" : "height";
          const peers = attachments.filter((peer) => peer.node === item.node && peer.side === item.side)
            .sort((x, y) => center(x.other.box)[axis] - center(y.other.box)[axis] || x.edge.id.localeCompare(y.edge.id, "en", { numeric: true }));
          const i = peers.indexOf(item), box = item.node.box;
          const left = peers.findLastIndex((peer, j) => j < i && peer.fixed !== undefined);
          const right = peers.findIndex((peer, j) => j > i && peer.fixed !== undefined);
          // A centered partial-overlap port may legally sit near a corner. Its
          // actual reservation, rather than an imaginary corner slot, bounds peers.
          const low = left < 0 ? box[axis] + jog + i * portSpacing : peers[left].fixed! + (i - left) * portSpacing;
          const high = right < 0 ? box[axis] + box[extent] - jog - (peers.length - i - 1) * portSpacing : peers[right].fixed! - (right - i) * portSpacing;
          return value >= low && value <= high &&
            peers.every((peer, j) => peer === item || peer.fixed === undefined || (value - peer.fixed) * Math.sign(i - j) >= portSpacing - 0.001);
        })));
      if (axis !== undefined) { a.fixed = b.fixed = axis; straight.set(a.edge, axis); }
    }
  };
  reserveStraight();
  // A diamond has four vertices, shared by all incoming and outgoing ends.
  // Straight ends and the first main-path exit own their facing vertex first.
  for (const node of scene.nodes.filter((node) => node.shape === "decision")) {
    const list = attachments.filter((item) => item.node === node && item.edge.source !== item.edge.target);
    const used = new Set<PortSide>();
    list.sort((a, b) => Number(b.fixed !== undefined) - Number(a.fixed !== undefined) ||
      Number(!!b.edge.main) - Number(!!a.edge.main) || Number(a.end === "source") - Number(b.end === "source"));
    for (const item of list) {
      const c = center(node.box), peer = center(item.other.box);
      const choices = [item.side, ...Object.keys(normal).filter((side) => side !== item.side)] as PortSide[];
      const side = choices.find((side) => !used.has(side) && (peer.x - c.x) * normal[side].x + (peer.y - c.y) * normal[side].y > 0)
        ?? choices.find((side) => !used.has(side)) ?? item.side;
      if (used.has(side)) layoutCompromise(scene, item.edge.id, `shares a decision vertex on ${node.id}; more than four incident ends`);
      if (side !== item.side) {
        delete item.fixed;
        const other = attachments.find((peer) => peer.edge === item.edge && peer !== item)!;
        delete other.fixed;
      }
      item.side = side; used.add(side);
    }
    for (const edge of scene.edges.filter((edge) => edge.source === node.id && edge.target === node.id)) {
      const choices = (["EAST", "WEST", "SOUTH", "NORTH"] as PortSide[]).filter((side) => !used.has(side));
      choices.sort((a, b) => Math.min(...decisionLoopPaths(node, a).map((path) => loopObstructions(scene, node, path))) -
        Math.min(...decisionLoopPaths(node, b).map((path) => loopObstructions(scene, node, path))));
      const side = choices[0] ?? "EAST";
      if (used.has(side)) layoutCompromise(scene, edge.id, `self-loop shares a decision vertex on ${node.id}`);
      for (const item of attachments.filter((item) => item.edge === edge)) { item.side = side; delete item.fixed; }
      used.add(side);
    }
  }
  // Prefer an unobstructed L when its two target-facing faces allow it.
  // Diamonds retain the vertex selected above; parallel exchanges retain lanes.
  for (let i = 0; i < attachments.length; i += 2) {
    const a = attachments[i], b = attachments[i + 1];
    if (a.fixed !== undefined || paired.has(a.edge) || deferred.has(a.edge) || a.node === b.node) continue;
    const choices = (item: Attachment) => {
      if (item.node.shape === "decision") return [item.side];
      const c = center(item.node.box), peer = center(item.other.box);
      return [item.side, ...Object.keys(normal).filter((side) => side !== item.side) as PortSide[]]
        .filter((side) => (peer.x - c.x) * normal[side].x + (peer.y - c.y) * normal[side].y > 0);
    };
    const boxes = portObstacles(scene, a.node, b.node);
    let found = false;
    for (const from of choices(a)) {
      for (const to of choices(b)) {
        if (vertical(from) === vertical(to)) continue;
        const p = facePoint(a.node, from), q = facePoint(b.node, to);
        const corner = vertical(from) ? { x: p.x, y: q.y } : { x: q.x, y: p.y };
        if (!outward(p, corner, from) || !outward(q, corner, to) || distance(p, corner) < leadLength || distance(q, corner) < leadLength ||
          boxes.some((box) => segmentCrossesBox(p, corner, box) || segmentCrossesBox(corner, q, box)) || !clearsZonePorts([p, corner, q], scene.containers)) continue;
        a.side = from; b.side = to; found = true; break;
      }
      if (found) break;
    }
  }
  // L branches no longer occupy their original straight-facing slots. Retry
  // the remaining overlaps using these final faces and the same ordering rule.
  reserveStraight();
  const ends = new Map<string, Attachment[]>();
  for (const item of attachments) {
    const key = `${item.node.id} ${item.side}`;
    ends.set(key, [...ends.get(key) ?? [], item]);
  }
  const ports = new Map<string, End>();
  const assign = (list: Attachment[]) => {
    const { node, side } = list[0], isVertical = vertical(side), c = center(node.box);
    const axis = isVertical ? "x" : "y";
    const peerAxis = (item: Attachment) => ports.get(`${item.edge.id} ${item.end === "source" ? "target" : "source"}`)?.point[axis] ?? center(item.other.box)[axis];
    list.sort((a, b) => center(a.other.box)[axis] - center(b.other.box)[axis] || peerAxis(a) - peerAxis(b) ||
      a.edge.id.localeCompare(b.edge.id, "en", { numeric: true }) || a.end.localeCompare(b.end));
    const multiple = edgePairs(list.map((item) => item.edge)).filter((pair) => pair.length >= 3).flat();
    const labelSpacing = !isVertical && list.length >= 3 && !edgePairs(list.map((item) => item.edge)).length
      ? Math.min(node.box.height / (list.length - 1), Math.max(0, ...list.flatMap((item) => item.edge.labels.map((label) => label.box.height + 8)))) : 0;
    const spacing = Math.max(list.some((item) => item.edge.source === item.edge.target) ? 60 : portSpacing,
      labelSpacing,
      ...multiple.flatMap((edge) => edge.labels.map((label) => (isVertical ? label.box.width : label.box.height) + 8)));
    const fixed = list.map((item, i) => ({ item, i })).filter(({ item }) => item.fixed !== undefined);
    for (const [i, item] of list.entries()) {
      let value = c[axis] + (i - (list.length - 1) / 2) * spacing;
      if (fixed.length) {
        const anchor = fixed.reduce((best, entry) => Math.abs(entry.i - i) < Math.abs(best.i - i) ? entry : best);
        value = anchor.item.fixed! + (i - anchor.i) * spacing;
      }
      if (item.fixed !== undefined) value = item.fixed;
      if (node.shape === "decision") value = c[axis];
      ports.set(`${item.edge.id} ${item.end}`, { node, side, point: facePoint(node, side, value) });
    }
  };
  for (const list of ends.values()) assign(list);
  const seen = new Set<string>();
  while (true) {
    const signature = JSON.stringify([...ports].map(([key, end]) => [key, end.point]));
    if (seen.has(signature)) break;
    seen.add(signature);
    let moved = false;
    for (const item of attachments) {
      if (item.fixed !== undefined || item.node.shape === "decision" || paired.has(item.edge)) continue;
      const end = ports.get(`${item.edge.id} ${item.end}`)!, axis = vertical(item.side) ? "x" : "y";
      const extent = vertical(item.side) ? "width" : "height", box = item.node.box;
      if (end.point[axis] >= box[axis] && end.point[axis] <= box[axis] + box[extent]) continue;
      // A reserved straight port must not push a branch beyond the outline.
      // Use the remaining target-facing side rather than moving that reservation.
      const c = center(box), peer = center(item.other.box);
      const side = (Object.keys(normal) as PortSide[]).find((side) => vertical(side) !== vertical(item.side) &&
        (peer.x - c.x) * normal[side].x + (peer.y - c.y) * normal[side].y > 0);
      if (!side) {
        item.fixed = clamp(end.point[axis], box[axis], box[axis] + box[extent]);
        layoutCompromise(scene, item.edge.id, `cannot preserve ordered port spacing on ${item.node.id}`);
        continue;
      }
      item.side = side;
      const other = attachments.find((other) => other.edge === item.edge && other !== item)!;
      if (other.fixed === undefined && other.node.shape !== "decision") other.side = facingSide(other.node.box, item.node.box, direction);
      moved = true;
    }
    if (moved) {
      ends.clear();
      for (const item of attachments) {
        const key = `${item.node.id} ${item.side}`;
        ends.set(key, [...ends.get(key) ?? [], item]);
      }
    }
    for (const list of ends.values()) assign(list);
  }
  for (const pair of edgePairs(scene.edges)) for (const edge of pair) {
    const start = ports.get(`${edge.id} source`)!, end = ports.get(`${edge.id} target`)!;
    const axis = vertical(start.side) ? "x" : "y";
    if (end.side !== opposite[start.side] || Math.abs(start.point[axis] - end.point[axis]) >= 0.001) continue;
    // Averaged lane offsets can differ by floating-point noise. Normalize that
    // shared coordinate before strict orthogonal routing and label measurement.
    end.point[axis] = start.point[axis];
    const n = normal[end.side];
    end.point = onOutline(end.node!, end.point, { x: end.point.x + n.x, y: end.point.y + n.y });
  }
  // Project an L onto legal border lanes before splitting it into zone
  // sections. Independent clamping at each border would create tiny offsets
  // that can only be repaired with four extra bends under the 16px jog rule.
  for (let i = 0; i < attachments.length; i += 2) {
    const a = attachments[i], b = attachments[i + 1];
    if (paired.has(a.edge) || a.node.parent === b.node.parent || vertical(a.side) === vertical(b.side) && b.side !== opposite[a.side]) continue;
    const start = ports.get(`${a.edge.id} source`)!, end = ports.get(`${a.edge.id} target`)!;
    const slots = (item: Attachment, own: End) => {
      const axis = vertical(own.side) ? "x" : "y", extent = axis === "x" ? "width" : "height";
      if (item.fixed !== undefined || item.node.shape === "decision") return [own.point];
      return [...new Set([own.point[axis], ...scene.containers.flatMap(({ box }) =>
        [box[axis] - leadLength, box[axis] + leadLength, box[axis] + box[extent] - leadLength, box[axis] + box[extent] + leadLength]),
        ...scene.containers.map((zone) => { const tab = tabBox(zone); return tab[axis] + tab[extent] + jog; })])]
        .filter((value) => value >= item.node.box[axis] && value <= item.node.box[axis] + item.node.box[extent] &&
          [...ports.values()].every((peer) => peer === own || peer.node !== own.node || peer.side !== own.side ||
            Math.abs(value - peer.point[axis]) >= 24 - 0.001 && (value - peer.point[axis]) * (own.point[axis] - peer.point[axis]) > 0))
        .sort((x, y) => Math.abs(x - own.point[axis]) - Math.abs(y - own.point[axis]))
        .map((value) => facePoint(item.node, own.side, value));
    };
    const candidates = slots(a, start).flatMap((p) => slots(b, end).map((q) => ({ p, q,
      cost: distance(p, start.point) + distance(q, end.point) }))).sort((a, b) => a.cost - b.cost);
    for (const { p, q } of candidates) {
      if (!minimumPath(scene, { ...start, point: p }, { ...end, point: q })) continue;
      start.point = p; end.point = q; break;
    }
  }
  const paths = attachments.filter((item) => item.end === "source").flatMap((item) => {
    const a = ports.get(`${item.edge.id} source`)!, b = ports.get(`${item.edge.id} target`)!;
    if (vertical(a.side) === vertical(b.side) || paired.has(item.edge)) return [];
    const corner = vertical(a.side) ? { x: a.point.x, y: b.point.y } : { x: b.point.x, y: a.point.y };
    if (!outward(a.point, corner, a.side) || !outward(b.point, corner, b.side) ||
      portObstacles(scene, a.node!, b.node!).some((box) => segmentCrossesBox(a.point, corner, box) || segmentCrossesBox(corner, b.point, box))) return [];
    return [{ item, a, b, points: [a.point, corner, b.point] }];
  });
  for (const [i, a] of paths.entries()) for (const b of paths.slice(i + 1)) {
    if (![a.a, a.b].some((p) => [b.a, b.b].some((q) => p.node === q.node && p.side === q.side)) ||
      !a.points.slice(1).some((p, i) => b.points.slice(1).some((q, j) => intersects(a.points[i], p, b.points[j], q)))) continue;
    // Two Ls may conflict despite individually clear geometry. Keep the outer
    // ordered route and return the other edge to its facing, two-bend pair.
    const span = (p: typeof a) => Math.abs(vertical(p.a.side) ? center(p.a.node!.box).x - center(p.b.node!.box).x : center(p.a.node!.box).y - center(p.b.node!.box).y);
    for (const candidate of [a, b].sort((a, b) => span(a) - span(b) || scene.edges.indexOf(b.item.edge) - scene.edges.indexOf(a.item.edge))) {
      const { item } = candidate;
      if (deferred.has(item.edge) || item.node.shape === "decision" || item.other.shape === "decision" ||
        candidate.a.side === escapeSide(scene, item.node, item.other, direction) && candidate.b.side === facingSide(item.other.box, item.node.box, direction)) continue;
      deferred.add(item.edge);
      return nodePorts(scene, direction, deferred, straight);
    }
  }
  return ports;
}

// Align a free sibling or incoming stem by node centers, never by a spread
// port. This preserves the target order of a fan-in without creating a crank
// on the very edge that establishes the shared straight lane.
function alignFanout(scene: Scene, direction: Direction) {
  const pairedNodes = new Set(edgePairs(scene.edges).flatMap((pair) => [pair[0].source, pair[0].target]));
  for (const edge of scene.edges) {
    const ports = nodePorts(scene, direction), a = ports.get(`${edge.id} source`), b = ports.get(`${edge.id} target`);
    if (!a?.node || !b?.node || a.node === b.node || a.node.parent !== b.node.parent ||
      a.node.shape !== "box" || b.node.shape !== "box" || pairedNodes.has(a.node.id) || pairedNodes.has(b.node.id)) continue;
    if (scene.edges.filter((edge) => edge.source === a.node!.id).length < 2) continue;
    const axis = vertical(a.side) ? "x" : "y", extent = axis === "x" ? "width" : "height";
    if (a.node.box[axis] + a.node.box[extent] <= b.node.box[axis] || b.node.box[axis] + b.node.box[extent] <= a.node.box[axis]) continue;
    let unit = [b.node], delta = center(a.node.box)[axis] - center(b.node.box)[axis];
    if (scene.edges.filter((edge) => edge.source === b.node!.id || edge.target === b.node!.id).length !== 1) {
      // Keep a multiply connected target fixed. Its source may instead move
      // together with a free incoming stem, preserving every straight join.
      unit = [a.node]; delta = -delta;
      for (let current = a.node; ;) {
        const incoming = scene.edges.filter((edge) => edge.target === current.id);
        if (incoming.length !== 1) break;
        const previous = scene.nodes.find((node) => node.id === incoming[0].source)!;
        if (!previous || previous === b.node || unit.includes(previous) || previous.parent !== a.node.parent || pairedNodes.has(previous.id) ||
          scene.edges.filter((edge) => edge.source === previous.id).length !== 1) break;
        unit.push(previous); current = previous;
      }
      if (unit.length === 1) continue;
    }
    const legal = unit.every((node) => {
      const moved = { ...node.box, [axis]: node.box[axis] + delta };
      if (scene.nodes.some((other) => !unit.includes(other) && overlaps(other.box, moved, clearance))) return false;
      const ancestors = new Set<string>();
      for (let p = node.parent; p; p = scene.containers.find((zone) => zone.id === p)?.parent) ancestors.add(p);
      if (scene.containers.some((zone) => !ancestors.has(zone.id) && overlaps(zone.box, moved, clearance))) return false;
      const region = scene.containers.find((zone) => zone.id === node.parent);
      if (region && (moved.x < region.box.x + clearance || moved.y < region.box.y + clearance ||
        moved.x + moved.width > region.box.x + region.box.width - clearance || moved.y + moved.height > region.box.y + region.box.height - clearance)) return false;
      return !scene.containers.some((zone) => overlaps(tabBox(zone), moved, clearance)) &&
        !scene.notes.some((note) => overlaps(note.box, moved, clearance));
    });
    if (legal) for (const node of unit) node.box[axis] += delta;
  }
}

// A free outside leaf can be trapped beside a zone that ends on its layer.
// Open the next clear layer slot rather than accepting a two-bend crank. Port
// allocation has already tried sliding along the face and a target-facing L.
function spaceForLeaf(scene: Scene, direction: Direction) {
  for (const node of scene.nodes) {
    if (node.parent && node.parent !== "root") continue;
    const incident = scene.edges.filter((edge) => edge.source === node.id || edge.target === node.id);
    if (incident.length !== 1 || incident[0].source === incident[0].target) continue;
    const edge = incident[0], ports = nodePorts(scene, direction);
    const start = ports.get(`${edge.id} source`)!, end = ports.get(`${edge.id} target`)!;
    const own = start.node === node ? start : end, other = start.node === node ? end : start;
    if (!other.node?.parent || other.node.parent === "root") continue;
    const path = minimumPath(scene, start, end);
    if (path && path.length <= 3) continue;
    const axis = vertical(own.side) ? "y" : "x", extent = axis === "x" ? "width" : "height";
    const sign = normal[own.side][axis];
    const obstacles = [...scene.nodes.filter((peer) => peer !== node), ...scene.containers, ...scene.notes].map((item) => item.box);
    const moves = [...new Set(obstacles.map((box) => sign > 0 ? box[axis] + box[extent] + clearance - node.box[axis]
      : box[axis] - clearance - node.box[axis] - node.box[extent]))]
      .filter((delta) => delta * sign > 0.01).sort((a, b) => Math.abs(a) - Math.abs(b));
    for (const delta of moves) {
      const box = { ...node.box, [axis]: node.box[axis] + delta };
      if ((center(other.node.box)[axis] - center(box)[axis]) * sign <= 0 || obstacles.some((obstacle) => overlaps(box, obstacle, clearance))) continue;
      const candidate = structuredClone(scene);
      candidate.nodes.find((peer) => peer.id === node.id)!.box = box;
      const moved = nodePorts(candidate, direction), a = moved.get(`${edge.id} source`)!, b = moved.get(`${edge.id} target`)!;
      const simple = minimumPath(candidate, a, b);
      if (!simple || simple.length > 3) continue;
      node.box = box;
      scene[extent] = Math.max(scene[extent], box[axis] + box[extent] + leadLength + clearance);
      break;
    }
  }
}

// Insert only the missing routing space, without resizing nodes. A cut through
// a containing zone widens its padding; all its descendants stay contained.
function widenRouteSpace(scene: Scene) {
  for (const axis of ["x", "y"] as const) {
    const extent = axis === "x" ? "width" : "height", gap = leadLength * 2 + clearance * 2;
    const values = [...new Set([...scene.nodes, ...scene.containers].flatMap(({ box }) => [box[axis], box[axis] + box[extent]]))].sort((a, b) => a - b);
    for (let i = values.length - 1; i > 0; i--) {
      const cut = (values[i - 1] + values[i]) / 2, delta = gap - (values[i] - values[i - 1]);
      if (delta <= 0 || scene.nodes.some(({ box }) => box[axis] < cut && box[axis] + box[extent] > cut)) continue;
      for (const { box } of [...scene.nodes, ...scene.containers, ...scene.notes]) {
        if (box[axis] >= cut) box[axis] += delta;
        else if (box[axis] + box[extent] > cut) box[extent] += delta;
      }
      scene[extent] += delta;
    }
  }
}

export function routeGraphLines(scene: Scene, direction: Direction, labels: boolean | "zone-gaps" = false) {
  spaceForLeaf(scene, direction);
  const base = structuredClone(scene);
  if (!routeGraphLinesOnce(scene, direction, labels, 0).size) return;
  const expanded = structuredClone(base);
  widenRouteSpace(expanded);
  if (!routeGraphLinesOnce(expanded, direction, labels, 0).size) { Object.assign(scene, expanded); return; }
  // Keep the widened layout for the longer detour and, only then, the border
  // clearance retry. The jog length and node normal leads never relax.
  for (const stage of [1, 2] as const) {
    const candidate = structuredClone(expanded);
    const failed = routeGraphLinesOnce(candidate, direction, labels, stage);
    if (!failed.size || stage === 2) { Object.assign(scene, candidate); return; }
  }
}

function routeGraphLinesOnce(scene: Scene, direction: Direction, labels: boolean | "zone-gaps", stage: 0 | 1 | 2) {
  const failed = new Set<string>();
  if (labels === true) scene.warnings = [];
  reserveStraightTabSpace(scene, direction);
  if (labels !== true && edgePairs(scene.edges).length) {
    const seen = new Set<string>();
    while (true) {
      const before = JSON.stringify([...scene.nodes, ...scene.containers].map((item) => [item.id, item.box]));
      if (seen.has(before)) {
        for (const pair of edgePairs(scene.edges)) for (const edge of pair) layoutCompromise(scene, edge.id, "paired lanes cannot all be aligned");
        break;
      }
      seen.add(before);
      alignPairs(scene, direction);
      if (before === JSON.stringify([...scene.nodes, ...scene.containers].map((item) => [item.id, item.box]))) break;
    }
  }
  alignFanout(scene, direction);
  reservePairedTabSpace(scene, direction);
  // Translation preserves the layout and leaves room for normal leads at the
  // canvas edge. Unlike scaling, it cannot shrink text or the 24px lane spacing.
  const all = [...scene.nodes, ...scene.containers];
  const margin = leadLength + clearance;
  const dx = Math.max(0, margin - Math.min(...all.map((item) => item.box.x))), dy = Math.max(0, margin - Math.min(...all.map((item) => item.box.y)));
  for (const item of all) { item.box.x += dx; item.box.y += dy; }
  scene.width = Math.max(scene.width + dx, ...all.map((item) => item.box.x + item.box.width + margin));
  scene.height = Math.max(scene.height + dy, ...all.map((item) => item.box.y + item.box.height + margin));
  for (const edge of scene.edges) if (edge.source === edge.target) {
    const node = scene.nodes.find((node) => node.id === edge.source);
    if (node) scene.width = Math.max(scene.width, node.box.x + node.box.width + leadLength + clearance);
  }
  const ports = nodePorts(scene, direction);
  const straight = (edge: SvgEdge) => {
    const a = ports.get(`${edge.id} source`), b = ports.get(`${edge.id} target`);
    return a?.node && b?.node && a.node !== b.node && a.side === opposite[b.side] &&
      outward(a.point, b.point, a.side) && !portObstacles(scene, a.node, b.node).some((box) => segmentCrossesBox(a.point, b.point, box)) ? 1 : 0;
  };
  for (const edge of scene.edges) edge.sections = [];
  const protectedSegments: [Point, Point][] = [...ports.values()].map((end) => {
    const n = normal[end.side];
    return [end.point, { x: end.point.x + n.x * leadLength, y: end.point.y + n.y * leadLength }];
  });
  const simplePaths = new Map<SvgEdge, Point[]>();
  for (const edge of scene.edges) {
    const a = ports.get(`${edge.id} source`)!, b = ports.get(`${edge.id} target`)!;
    if (straight(edge)) simplePaths.set(edge, [a.point, b.point]);
    else if (a?.node && b?.node && vertical(a.side) !== vertical(b.side)) {
      const corner = vertical(a.side) ? { x: a.point.x, y: b.point.y } : { x: b.point.x, y: a.point.y };
      if (outward(a.point, corner, a.side) && outward(b.point, corner, b.side) &&
        !portObstacles(scene, a.node, b.node).some((box) => segmentCrossesBox(a.point, corner, box) || segmentCrossesBox(corner, b.point, box))) {
        simplePaths.set(edge, [a.point, corner, b.point]);
      }
    }
  }
  const sameFace = (a: SvgEdge, b: SvgEdge) => (["source", "target"] as const).some((side) => (["source", "target"] as const).some((peer) => {
    const own = ports.get(`${a.id} ${side}`), theirs = ports.get(`${b.id} ${peer}`);
    return own?.node && own.node === theirs?.node && own.side === theirs.side;
  }));
  const span = (edge: SvgEdge) => {
    const a = ports.get(`${edge.id} source`)!, b = ports.get(`${edge.id} target`)!;
    return a && b ? Math.abs(vertical(a.side) ? center(a.node!.box).x - center(b.node!.box).x : center(a.node!.box).y - center(b.node!.box).y) : 0;
  };
  for (const [edge, path] of simplePaths) {
    const blocked = [...simplePaths].some(([other, route]) => other !== edge && sameFace(edge, other) &&
      (straight(other) > straight(edge) || straight(other) === straight(edge) && (span(other) > span(edge) || span(other) === span(edge) && scene.edges.indexOf(other) < scene.edges.indexOf(edge))) &&
      path.slice(1).some((b, i) => route.slice(1).some((q, j) => intersects(path[i], b, route[j], q))));
    if (!blocked) for (let i = 1; i < path.length; i++) protectedSegments.push([path[i - 1], path[i]]);
  }
  const zoneById = new Map(scene.containers.map((zone) => [zone.id, zone]));
  const ancestors = (id: string | undefined) => {
    const list: string[] = [];
    for (let p = id; p && p !== "root"; p = zoneById.get(p)?.parent) list.push(p);
    return [...list, "root"];
  };
  for (const zone of scene.containers) zone.ports = [];
  const occupied: [Point, Point][] = [];
  const drawn: SvgEdge[] = [];
  const paired = new Set(edgePairs(scene.edges).flat());
  const plans = new Map<SvgEdge, RoutePart[]>();
  const gapLabels = new Set<SvgEdge>();
  for (const edge of scene.edges) {
    const start = ports.get(`${edge.id} source`), end = ports.get(`${edge.id} target`);
    if (!start || !end) continue;
    const from = ancestors(start.node?.parent), to = ancestors(end.node?.parent), common = from.find((id) => to.includes(id))!;
    if (common !== "root" && start.node?.parent !== end.node?.parent) gapLabels.add(edge);
    if (start.node === end.node && start.node?.shape === "decision") {
      const loops = decisionLoopPaths(start.node, start.side);
      loops.sort((a, b) => loopObstructions(scene, start.node!, a) - loopObstructions(scene, start.node!, b));
      plans.set(edge, [{ owner: common, start, end, path: loops[0] }]);
      continue;
    }
    const simple = simplePlan(scene, start, end, edge.id);
    if (simple) {
      plans.set(edge, simple);
      continue;
    }
    const before: RoutePart[] = [], after: typeof before = [];
    let a = start, b = end;
    const boundary = (id: string, inner: End, other: End, incoming: boolean): End => {
      const zone = zoneById.get(id)!;
      const side = inner.node ? inner.side : facingSide(zone.box, other.node!.box, direction);
      const port = incoming ? zoneEnd(zone, inner, side) : escapeEnd(scene, zone, inner, other.node!, direction, other.point);
      zone.ports!.push({ id: `${edge.id}-${id}`, edge: edge.id, side: port.side, point: port.point, incoming });
      return port;
    };
    for (const id of from.slice(0, from.indexOf(common))) {
      const port = boundary(id, a, end, false);
      before.push({ owner: id, start: a, end: { ...port, side: opposite[port.side] } }); a = port;
    }
    for (const id of to.slice(0, to.indexOf(common))) {
      const port = boundary(id, b, start, true);
      after.unshift({ owner: id, start: { ...port, side: opposite[port.side] }, end: b }); b = port;
    }
    const parts = [...before, { owner: common, start: a, end: b }, ...after];
    plans.set(edge, parts);
  }
  const leadOf = (end: End): [Point, Point] => {
    const n = normal[end.side];
    return [end.point, { x: end.point.x + n.x * leadLength, y: end.point.y + n.y * leadLength }];
  };
  for (const parts of plans.values()) for (const part of parts) protectedSegments.push(leadOf(part.start), leadOf(part.end));
  for (const edge of [...scene.edges].sort((a, b) => Number(paired.has(b)) - Number(paired.has(a)) || straight(b) - straight(a) || span(b) - span(a))) {
    const parts = plans.get(edge);
    if (!parts) continue;
    const forbidden = drawn.filter((other) => sameFace(edge, other)).flatMap((other) => other.sections.flatMap((section) => section.slice(1).map((p, i) => [section[i], p] as [Point, Point])));
    for (const [other, plan] of plans) if (other !== edge && sameFace(edge, other)) for (const part of plan) forbidden.push(leadOf(part.start), leadOf(part.end));
    edge.sectionOwners = parts.map((part) => part.owner);
    edge.sections = parts.map((part, index) => {
      const region = zoneById.get(part.owner), chain = new Set(ancestors(part.owner));
      const boxes = [...scene.nodes.map((node) => inflate(node.box, clearance)),
        ...scene.containers.filter((zone) => !chain.has(zone.id)).map((zone) => inflate(zone.box, clearance)),
        ...scene.containers.map((zone) => inflate(tabBox(zone), 4)),
        ...(labels ? drawn.filter((edge) => labels === true || gapLabels.has(edge)).flatMap((edge) => edge.labels.map((label) => inflate(label.box, 4))) : [])];
      // A crossed zone is an obstacle in the outside section, except for its
      // perpendicular lead. The search begins beyond its inflated border.
      const bounds = region ? inflate(region.box, -clearance) : { x: 0, y: 0, width: scene.width, height: scene.height };
      const reserved = [...forbidden];
      // A late source must still be able to reach its ordered incoming lane.
      // Reserve its clear, monotone approach before an earlier arrow can cut it
      // off. Fixed normal leads alone protect only the last 24px of a fan-in.
      for (const [other, plan] of plans) {
        const ownTarget = ports.get(`${edge.id} target`)!, peerTarget = ports.get(`${other.id} target`)!;
        if (other === edge || drawn.includes(other) || edge.source === other.source || ownTarget.node !== peerTarget.node || ownTarget.side !== peerTarget.side) continue;
        for (const peer of plan.filter((peer) => peer.owner === part.owner && vertical(peer.start.side) === vertical(peer.end.side))) {
          const a = leadOf(peer.start)[1], b = leadOf(peer.end)[1];
          const corner = vertical(peer.start.side) ? { x: b.x, y: a.y } : { x: a.x, y: b.y };
          const route = compact([a, corner, b]);
          if (route.slice(1).some((point, i) => boxes.some((box) => segmentCrossesBox(route[i], point, box)))) continue;
          for (let i = 1; i < route.length; i++) reserved.push([route[i - 1], route[i]]);
        }
      }
      if (part.path && !part.path.slice(1).some((b, i) => reserved.some(([p, q]) => intersects(part.path![i], b, p, q)) ||
        (labels ? drawn.flatMap((edge) => edge.labels.map((label) => inflate(label.box, 4))) : []).some((box) => segmentCrossesBox(part.path![i], b, box)))) return part.path;
      {
        const goals = { padding: stage < 2 ? clearance : 0, maxDetour: stage === 0 ? 1.8 : Infinity };
        const obstacles = stage < 2 ? boxes : [...scene.nodes.map((node) => node.box),
          ...scene.containers.filter((zone) => !chain.has(zone.id)).map((zone) => zone.box),
          ...scene.containers.map(tabBox),
          ...(labels ? drawn.filter((edge) => labels === true || gapLabels.has(edge)).flatMap((edge) => edge.labels.map((label) => label.box)) : [])];
        const area = stage < 2 ? bounds : region?.box ?? bounds;
        const path = orthogonalRoute(part.start, part.end, obstacles, area, occupied, reserved, goals);
        if (path) return path;
      }
      failed.add(edge.id);
      if (stage === 2) layoutCompromise(scene, edge.id, `route cannot preserve obstacle or shared-face clearance in section ${index}`);
      const a = part.start.point, b = part.end.point, margin = leadLength * 2;
      const area = { x: Math.min(a.x, b.x) - margin, y: Math.min(a.y, b.y) - margin,
        width: Math.abs(a.x - b.x) + margin * 2, height: Math.abs(a.y - b.y) + margin * 2 };
      return orthogonalRoute(part.start, part.end, [], area, [], [], { padding: 0, maxDetour: Infinity })!;
    });
    for (const section of edge.sections) for (let i = 1; i < section.length; i++) occupied.push([section[i - 1], section[i]]);
    if (labels === true || labels === "zone-gaps" && gapLabels.has(edge)) placeEdgeLabels(scene, direction, [edge], protectedSegments, (a, b) => {
      const h = a.y === b.y, axis = h ? a.y : a.x;
      const source = ports.get(`${edge.id} source`)!;
      const sourcePeers = [...ports.values()].filter((port) => port.node === source.node && port.side === source.side);
      const sharesPair = [...paired].some((other) => [ports.get(`${other.id} source`)!, ports.get(`${other.id} target`)!]
        .some((port) => port.node === source.node && port.side === source.side));
      // Parallel horizontal lanes have room for one pill per gap. Alternating
      // their preferred sides would make adjacent pills compete for that gap.
      if (!vertical(source.side) && !sharesPair && sourcePeers.length >= 3) return -1;
      for (const end of ["target", "source"]) {
        const own = ports.get(`${edge.id} ${end}`)!;
        if (h === vertical(own.side) || Math.abs((h ? own.point.y : own.point.x) - axis) > 0.01) continue;
        const peers = [...ports.values()].filter((port) => port.node === own.node && port.side === own.side);
        if (peers.length < 2) continue;
        const axes = peers.map((port) => h ? port.point.y : port.point.x);
        const side = Math.sign(axis - (Math.min(...axes) + Math.max(...axes)) / 2);
        if (side) return side;
      }
      return 0;
    }, drawn.filter((edge) => labels === true || gapLabels.has(edge)));
    drawn.push(edge);
  }
  return failed;
}

// ELK reserves lanes for its own routes. After ports and routes are normalized,
// release only unused outer padding; keep labels, descendants and exit ports.
export function tightenGraphZones(scene: Scene): boolean {
  let changed = false;
  const inside = (node: SvgNode, id: string) => {
    for (let p = node.parent; p && p !== "root"; p = scene.containers.find((zone) => zone.id === p)?.parent) if (p === id) return true;
    return false;
  };
  for (const zone of [...scene.containers].sort((a, b) => a.box.width * a.box.height - b.box.width * b.box.height)) {
    const box = zone.box;
    const content: Box[] = [...scene.nodes.filter((node) => inside(node, zone.id)).map((node) => node.box),
      ...scene.containers.filter((child) => child.parent === zone.id).map((child) => child.box),
      ...(zone.ports ?? []).map(({ point }) => ({ ...point, width: 0, height: 0 })),
      ...scene.edges.flatMap((edge) => edge.labels.filter((label) => label.box.x >= box.x && label.box.y >= box.y &&
        label.box.x + label.box.width <= box.x + box.width && label.box.y + label.box.height <= box.y + box.height).map((label) => label.box))];
    for (const edge of scene.edges) if (scene.nodes.some((node) => node.id === edge.source && inside(node, zone.id))) {
      for (const section of edge.sections) for (let i = 1; i < section.length; i++) {
        const a = section[i - 1], b = section[i];
        const x = Math.max(box.x, Math.min(a.x, b.x)), y = Math.max(box.y, Math.min(a.y, b.y));
        const right = Math.min(box.x + box.width, Math.max(a.x, b.x)), bottom = Math.min(box.y + box.height, Math.max(a.y, b.y));
        if (right >= x && bottom >= y) content.push({ x, y, width: right - x, height: bottom - y });
      }
    }
    if (!content.length) continue;
    const left = Math.min(...content.map((item) => item.x)) - 40;
    const right = Math.max(...content.map((item) => item.x + item.width)) + 40;
    const bottom = Math.max(...content.map((item) => item.y + item.height)) + 40;
    const tabLimit = Math.min(Infinity, ...(zone.ports ?? []).filter((port) => port.side === "NORTH").map((port) => port.point.x - tabBox(zone).width - jog));
    if (left > box.x + 0.01 && left <= tabLimit + 0.01 && box.x + box.width - left >= tabBox(zone).width + 48) { box.width -= left - box.x; box.x = left; changed = true; }
    if (right < box.x + box.width - 0.01) {
      const width = Math.max(right - box.x, tabBox(zone).width + 48);
      if (width < box.width - 0.01) { box.width = width; changed = true; }
    }
    if (bottom < box.y + box.height - 0.01) { box.height = bottom - box.y; changed = true; }
  }
  return changed;
}
