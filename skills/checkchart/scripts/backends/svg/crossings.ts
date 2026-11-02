import type { Point, SvgEdge } from "./scene.ts";

type Segment = { a: Point; b: Point };
// Geometry tolerance only; it does not decide whether a readability warning fires.
const EPSILON = 1e-7;
const cross = (a: Point, b: Point) => a.x * b.y - a.y * b.x;
const vector = (a: Point, b: Point) => ({ x: b.x - a.x, y: b.y - a.y });
const distance = (a: Point, b: Point) => Math.hypot(b.x - a.x, b.y - a.y);

function intersection(left: Segment, right: Segment): Point | undefined {
  const r = vector(left.a, left.b), s = vector(right.a, right.b);
  const denominator = cross(r, s);
  if (Math.abs(denominator) < EPSILON) return undefined; // Parallel or shared route.
  const offset = vector(left.a, right.a);
  const t = cross(offset, s) / denominator, u = cross(offset, r) / denominator;
  if (t < -EPSILON || t > 1 + EPSILON || u < -EPSILON || u > 1 + EPSILON) return undefined;
  return { x: left.a.x + t * r.x, y: left.a.y + t * r.y };
}

function raysAt(segments: Segment[], point: Point): number[] {
  const rays: number[] = [];
  for (const { a, b } of segments) {
    if (Math.abs(cross(vector(a, point), vector(a, b))) > EPSILON * distance(a, b)) continue;
    if (point.x < Math.min(a.x, b.x) - EPSILON || point.x > Math.max(a.x, b.x) + EPSILON ||
        point.y < Math.min(a.y, b.y) - EPSILON || point.y > Math.max(a.y, b.y) + EPSILON) continue;
    for (const end of [a, b]) if (distance(point, end) > EPSILON) {
      const angle = (Math.atan2(end.y - point.y, end.x - point.x) + 2 * Math.PI) % (2 * Math.PI);
      if (!rays.some((previous) => Math.abs(Math.sin((previous - angle) / 2)) < EPSILON)) rays.push(angle);
    }
  }
  return rays;
}

// Count each edge pair's crossing point once, including at a section subdivision.
// Alternating rays distinguish a crossing from shared endpoints, T contacts and bends that touch.
export function countCrossings(edges: Pick<SvgEdge, "id" | "sections">[]): number {
  const routes = edges.map((edge) => edge.sections.flatMap((section) => section.slice(1).map((b, index) => ({ a: section[index], b })))
    .filter(({ a, b }) => distance(a, b) > EPSILON));
  let count = 0;
  for (const [index, left] of routes.entries()) for (const right of routes.slice(index + 1)) {
    const points: Point[] = [];
    for (const a of left) for (const b of right) {
      const point = intersection(a, b);
      if (point && !points.some((previous) => distance(previous, point) < EPSILON)) points.push(point);
    }
    for (const point of points) {
      const a = raysAt(left, point), b = raysAt(right, point);
      if (a.length !== 2 || b.length !== 2) continue;
      const rays = [...a.map((angle) => ({ angle, edge: 0 })), ...b.map((angle) => ({ angle, edge: 1 }))].sort((a, b) => a.angle - b.angle);
      if (rays.every((ray, index) => {
        const next = rays[(index + 1) % rays.length];
        return ray.edge !== next.edge && Math.abs(Math.sin((ray.angle - next.angle) / 2)) > EPSILON;
      })) count++;
    }
  }
  return count;
}
