import assert from "node:assert/strict";
import type { Box, Point } from "../backends/svg/scene.ts";
import type { Model } from "../ir.ts";

const near = (a: number, b: number) => Math.abs(a - b) <= 0.03;
const center = (box: Box) => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 });
const boxOf = (text: string): Box => {
  const [x, y, width, height] = text.split(" ").map(Number);
  return { x, y, width, height };
};
const flat = (sections: Point[][]) => sections.flat().filter((p, i, all) => !i || !near(p.x, all[i - 1].x) || !near(p.y, all[i - 1].y))
  .filter((p, i, all) => !i || i === all.length - 1 ||
    !(near(all[i - 1].x, p.x) && near(p.x, all[i + 1].x) || near(all[i - 1].y, p.y) && near(p.y, all[i + 1].y)));

// Independent reachability check: only solid nodes and measured text block a
// face. Other arrows and zone outlines cannot justify changing the node face.
function faceCanReach(box: Box, target: Box, vertical: boolean, sign: number, obstacles: Box[]): boolean {
  const boxes = obstacles.filter((b) => !(b.x >= target.x && b.y >= target.y &&
    b.x + b.width <= target.x + target.width && b.y + b.height <= target.y + target.height));
  const clear = (a: Point, b: Point) => !boxes.some((box) =>
    Math.max(a.x, b.x) > box.x + 0.03 && Math.min(a.x, b.x) < box.x + box.width - 0.03 &&
    Math.max(a.y, b.y) > box.y + 0.03 && Math.min(a.y, b.y) < box.y + box.height - 0.03);
  const axis = vertical ? "x" : "y", extent = vertical ? "width" : "height";
  const across = vertical ? "y" : "x", depth = vertical ? "height" : "width";
  const face = box[across] + (sign > 0 ? box[depth] : 0);
  const slots = [box[axis], box[axis] + box[extent], center(box)[axis],
    ...boxes.flatMap((b) => [b[axis], b[axis] + b[extent]])].filter((v) => v >= box[axis] && v <= box[axis] + box[extent]);
  const starts = slots.map((v) => vertical ? { x: v, y: face + sign * 0.04 } : { x: face + sign * 0.04, y: v })
    .filter((p) => clear(vertical ? { x: p.x, y: face } : { x: face, y: p.y }, p));
  const end = center(target);
  const xs = [...new Set([end.x, ...starts.map((p) => p.x), ...boxes.flatMap((b) => [b.x, b.x + b.width])])].sort((a, b) => a - b);
  const ys = [...new Set([end.y, ...starts.map((p) => p.y), ...boxes.flatMap((b) => [b.y, b.y + b.height])])].sort((a, b) => a - b);
  const id = (p: Point) => ys.indexOf(p.y) * xs.length + xs.indexOf(p.x);
  const pending = starts.map(id), seen = new Set(pending), last = id(end);
  for (let i = 0; i < pending.length; i++) {
    const current = pending[i], x = current % xs.length, y = Math.floor(current / xs.length);
    if (current === last) return true;
    for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
      const next = ny * xs.length + nx;
      if (nx < 0 || nx >= xs.length || ny < 0 || ny >= ys.length || seen.has(next) ||
        !clear({ x: xs[x], y: ys[y] }, { x: xs[nx], y: ys[ny] })) continue;
      seen.add(next); pending.push(next);
    }
  }
  return false;
}

// Sequence arrows attach to lifelines at successive message rows, not to the
// participant header faces. Graph face/port rules therefore apply to e* only;
// sequence routes still receive the clearance, jog and border checks below.
export function lineQuality(svg: string, model: Model) {
  const nodes = new Map([...svg.matchAll(/id="node-([^"]+)"[^>]*data-node="([^"]+)"/g)].map((m) => [m[1], boxOf(m[2])]));
  const diamonds = new Set([...svg.matchAll(/id="node-([^"]+)" class="node decision /g)].map((m) => m[1]));
  const zones = new Map([...svg.matchAll(/id="container-([^"]+)"[^>]*data-container="([^"]+)"/g)].map((m) => [m[1], boxOf(m[2])]));
  const edges = [...svg.matchAll(/<g id="edge-([^"]+)"([^>]*)>(.*?)<\/g>/g)].map((m) => ({
    id: m[1], source: m[2].match(/data-source="([^"]+)"/)?.[1], target: m[2].match(/data-target="([^"]+)"/)?.[1],
    points: flat([...m[3].matchAll(/data-points="([^"]+)"/g)].map((s) => s[1].split(" ").map((p) => {
      const [x, y] = p.split(",").map(Number); return { x, y };
    }))),
  }));
  const labels = new Map([...svg.matchAll(/id="label-([^"]+)-label" data-pill="([^"]+)"/g)].map((m) => [m[1], boxOf(m[2])]));
  const obstacles = [...nodes.values(), ...[...svg.matchAll(/data-(?:text|tab|pill)="([^"]+)"/g)].map((m) => boxOf(m[1]))];
  const faceViolations: string[] = [], portViolations: string[] = [], pairViolations: string[] = [];
  const clearanceViolations: string[] = [], jogViolations: string[] = [], crossingViolations: string[] = [];
  const radiusViolations: string[] = [];
  for (const match of svg.matchAll(/L ([-.\d]+),([-.\d]+) Q ([-.\d]+),([-.\d]+) ([-.\d]+),([-.\d]+)/g)) {
    const [px, py, bx, by, qx, qy] = match.slice(1).map(Number);
    if (Math.abs(Math.hypot(bx - px, by - py) - 4) > 0.03 || Math.abs(Math.hypot(qx - bx, qy - by) - 4) > 0.03) radiusViolations.push(match[0]);
  }
  const attachments = new Map<string, { axis: number; other: number; point: Point; next: Point; edge: string }[]>();
  let minClearance = Infinity, minJog = Infinity, minPairSpacing = Infinity, maxCenterError = 0, maxZoneCrossings = 0;
  for (const edge of edges) {
    const { points } = edge;
    assert.ok(points.length >= 2, `${edge.id} has no route`);
    if (edge.source && edge.target && edge.source !== edge.target) {
      const source = nodes.get(edge.source)!, target = nodes.get(edge.target)!;
      // Check the preferred reading face across zones as well as within them.
      for (const [id, box, other, p, q] of [
        [edge.source, source, target, points[0], points[1]],
        [edge.target, target, source, points.at(-1)!, points.at(-2)!],
      ] as const) {
        const c = center(box), oc = center(other);
        const dx = q.x - p.x, dy = q.y - p.y;
        const faceVertical = near(dx, 0), side = faceVertical ? dy > 0 ? "SOUTH" : "NORTH" : dx > 0 ? "EAST" : "WEST";
        const dot = (oc.x - c.x) * dx + (oc.y - c.y) * dy;
        const diamond = diamonds.has(id);
        const xGap = box.x + box.width <= other.x + 0.03 || other.x + other.width <= box.x + 0.03;
        const yGap = box.y + box.height <= other.y + 0.03 || other.y + other.height <= box.y + 0.03;
        const preferredVertical = model.kind === "sequence" || !["LR", "RL"].includes(model.direction) ? yGap || !xGap : yGap && !xGap;
        const sign = Math.sign(preferredVertical ? oc.y - c.y : oc.x - c.x);
        const preferred = preferredVertical ? sign > 0 ? "SOUTH" : "NORTH" : sign > 0 ? "EAST" : "WEST";
        const vertex = preferredVertical ? { x: c.x, y: sign > 0 ? box.y + box.height : box.y }
          : { x: sign > 0 ? box.x + box.width : box.x, y: c.y };
        const reservedVertex = diamond && edges.some((other) => other !== edge &&
          [[other.source, other.points[0]], [other.target, other.points.at(-1)!]].some(([peer, point]) => peer === id &&
            near((point as Point).x, vertex.x) && near((point as Point).y, vertex.y)));
        if ((!faceVertical && !near(dy, 0)) || dot < 0 || dot === 0 && !reservedVertex) faceViolations.push(`${edge.id} / ${id}: face points away from its peer`);
        if (side !== preferred && points.length !== 3 && !diamond && faceCanReach(box, other, preferredVertical, sign, obstacles)) {
          faceViolations.push(`${edge.id} / ${id}: ${side} replaces reachable ${preferred} face`);
        }
        const key = `${id} ${side}`, list = attachments.get(key) ?? [];
        list.push({ axis: faceVertical ? p.x : p.y, other: faceVertical ? oc.x : oc.y, point: p, next: q, edge: edge.id });
        attachments.set(key, list);
      }
    }
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i];
      const length = Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
      minJog = Math.min(minJog, length);
      if (length < 16 - 0.03) jogViolations.push(`${edge.id} segment ${i}: ${length}`);
      const vertical = near(a.x, b.x);
      if (!vertical && !near(a.y, b.y)) faceViolations.push(`${edge.id} diagonal segment ${i}`);
      for (const [id, box] of [...nodes, ...zones]) {
        const low = vertical ? Math.min(a.y, b.y) : Math.min(a.x, b.x), high = vertical ? Math.max(a.y, b.y) : Math.max(a.x, b.x);
        const overlap = Math.min(high, vertical ? box.y + box.height : box.x + box.width) - Math.max(low, vertical ? box.y : box.x);
        if (overlap <= 0.03) continue;
        const axis = vertical ? a.x : a.y;
        const clearance = Math.min(...(vertical ? [box.x, box.x + box.width] : [box.y, box.y + box.height]).map((n) => Math.abs(axis - n)));
        minClearance = Math.min(minClearance, clearance);
        if (clearance < 12 - 0.03) clearanceViolations.push(`${edge.id} / ${id} segment ${i}: ${clearance}`);
      }
    }
    for (const [id, box] of zones) {
      const hits = new Set<string>();
      for (let i = 1; i < points.length; i++) {
        const a = points[i - 1], b = points[i];
        if (near(a.x, b.x) && a.x > box.x + 0.03 && a.x < box.x + box.width - 0.03) {
          for (const y of [box.y, box.y + box.height]) if (y >= Math.min(a.y, b.y) - 0.03 && y <= Math.max(a.y, b.y) + 0.03) hits.add(`${a.x.toFixed(2)},${y.toFixed(2)}`);
        } else if (near(a.y, b.y) && a.y > box.y + 0.03 && a.y < box.y + box.height - 0.03) {
          for (const x of [box.x, box.x + box.width]) if (x >= Math.min(a.x, b.x) - 0.03 && x <= Math.max(a.x, b.x) + 0.03) hits.add(`${x.toFixed(2)},${a.y.toFixed(2)}`);
        }
      }
      maxZoneCrossings = Math.max(maxZoneCrossings, hits.size);
      if (hits.size > 1) crossingViolations.push(`${edge.id} / ${id}: ${hits.size}`);
    }
  }
  for (const [key, ports] of attachments) {
    const [id, side] = key.split(" "), box = nodes.get(id)!;
    const mid = ["NORTH", "SOUTH"].includes(side) ? center(box).x : center(box).y;
    ports.sort((a, b) => a.axis - b.axis);
    const error = Math.abs((ports[0].axis + ports.at(-1)!.axis) / 2 - mid);
    maxCenterError = Math.max(maxCenterError, error);
    const pairOnly = ports.length > 1 && ports.every((port) => {
      const edge = edges.find((edge) => edge.id === port.edge)!;
      return edge.source === edges.find((edge) => edge.id === ports[0].edge)!.source && edge.target === edges.find((edge) => edge.id === ports[0].edge)!.target ||
        edge.target === edges.find((edge) => edge.id === ports[0].edge)!.source && edge.source === edges.find((edge) => edge.id === ports[0].edge)!.target;
    });
    const anchored = !pairOnly && ports.some((port) => edges.find((edge) => edge.id === port.edge)!.points.length <= 3);
    if (error > 1 && !anchored) portViolations.push(`${key}: off center by ${error}`);
    const gap = ports.length > 1 ? (ports.at(-1)!.axis - ports[0].axis) / (ports.length - 1) : 0;
    for (let i = 1; i < ports.length; i++) {
      if (!anchored && Math.abs(ports[i].axis - ports[i - 1].axis - gap) > 1 || ports[i].axis - ports[i - 1].axis < 24 - 0.03) portViolations.push(`${key}: uneven or crowded ports`);
      if (ports[i].other < ports[i - 1].other - 0.03) portViolations.push(`${key}: ports reverse the other-end order`);
    }
    // Test the actual first 24px, including turns: ordering alone cannot prove
    // that two routes do not cross immediately outside the face.
    for (const port of ports) {
      const vertical = ["NORTH", "SOUTH"].includes(side), low = vertical ? box.x : box.y, high = low + (vertical ? box.width : box.height);
      if (port.axis < low - 0.03 || port.axis > high + 0.03) portViolations.push(`${key}: ${port.edge} misses the outline`);
      if (diamonds.has(id) && (!near(port.axis, mid) || ports.length !== 1)) portViolations.push(`${key}: one edge must attach at the vertex`);
      const edge = edges.find((edge) => edge.id === port.edge)!;
      const points = edge.source === id ? edge.points : [...edge.points].reverse();
      if (points.length > 2 && Math.abs(points[1].x - points[0].x) + Math.abs(points[1].y - points[0].y) < 24 - 0.03) portViolations.push(`${key}: ${port.edge} turns within 24px`);
    }
  }
  const pairs = new Map<string, typeof edges>();
  for (const edge of edges) if (edge.source && edge.target && edge.source !== edge.target) {
    const key = [edge.source, edge.target].sort().join(" ");
    pairs.set(key, [...pairs.get(key) ?? [], edge]);
  }
  for (const [key, pair] of pairs) if (pair.length > 1) {
    // Distinct diamond vertices take precedence over parallel box-face lanes.
    if (key.split(" ").some((id) => diamonds.has(id))) continue;
    const vertical = near(pair[0].points[0].x, pair[0].points[1].x);
    const routes = pair.map((edge) => edge.source === key.split(" ")[0] ? edge.points : [...edge.points].reverse());
    const axes = routes.map((p) => vertical ? p[0].x : p[0].y).sort((a, b) => a - b);
    for (let i = 1; i < axes.length; i++) {
      minPairSpacing = Math.min(minPairSpacing, axes[i] - axes[i - 1]);
      if (axes[i] - axes[i - 1] < 24 - 0.03) pairViolations.push(`${key}: pair spacing ${axes[i] - axes[i - 1]}`);
    }
    const a = nodes.get(key.split(" ")[0])!, b = nodes.get(key.split(" ")[1])!;
    const overlap = vertical ? Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) : Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
    if (overlap < 24 * (pair.length - 1)) pairViolations.push(`${key}: paired faces do not overlap`);
    if (routes.some((p) => p.length !== 2)) pairViolations.push(`${key}: paired routes bend`);
    for (const edge of pair) {
      const label = labels.get(edge.id);
      if (pair.length === 2 && label && (vertical ? label.x + label.width > axes[0] - 4 + 0.03 && label.x < axes.at(-1)! + 4 - 0.03
        : label.y + label.height > axes[0] - 4 + 0.03 && label.y < axes.at(-1)! + 4 - 0.03)) pairViolations.push(`${edge.id}: label between pair lines`);
    }
  }
  return { faceViolations, portViolations, pairViolations, clearanceViolations, jogViolations, crossingViolations, radiusViolations,
    minClearance: Number.isFinite(minClearance) ? minClearance : null, minJog: Number.isFinite(minJog) ? minJog : null,
    minPairSpacing: Number.isFinite(minPairSpacing) ? minPairSpacing : null, maxCenterError, maxZoneCrossings };
}

export function assertLineQuality(svg: string, model: Model) {
  const result = lineQuality(svg, model);
  for (const key of ["faceViolations", "portViolations", "pairViolations", "clearanceViolations", "jogViolations", "crossingViolations", "radiusViolations"] as const) assert.deepEqual(result[key], [], key);
  return result;
}
