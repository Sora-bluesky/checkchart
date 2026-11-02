import { layoutCompromise, nodeTextBox, tabBox, type Box, type Point, type PortSide, type Scene, type SvgEdge } from "./scene.ts";
import { orthogonalRoute } from "./routing.ts";
import type { TextBlock } from "./text.ts";

export const segmentCrossesBox = (a: Point, b: Point, box: Box) =>
  Math.max(a.x, b.x) > box.x + 0.01 && Math.min(a.x, b.x) < box.x + box.width - 0.01 &&
  Math.max(a.y, b.y) > box.y + 0.01 && Math.min(a.y, b.y) < box.y + box.height - 0.01;
const same = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y) < 0.01;
const outward: Record<PortSide, Point> = { NORTH: { x: 0, y: -1 }, SOUTH: { x: 0, y: 1 },
  WEST: { x: -1, y: 0 }, EAST: { x: 1, y: 0 } };

export function textObstacles(scene: Scene): Box[] {
  return [...scene.containers.map(tabBox), ...scene.nodes.map(nodeTextBox), ...scene.notes.map((note) => note.box),
    ...scene.edges.flatMap((edge) => edge.labels.map((label) => label.box)),
    ...scene.frames.flatMap((frame) => [{ x: frame.box.x, y: frame.box.y, width: 46, height: 26 },
      ...frame.branches.map((branch) => ({ x: frame.box.x + 12, y: branch.y, width: branch.text.width, height: branch.text.height }))])];
}

function normalAt(scene: Scene, edge: SvgEdge, point: Point, neighbor: Point, owner?: string): Point {
  for (const zone of scene.containers) for (const port of zone.ports ?? []) {
    if (port.edge !== edge.id || !same(point, port.point)) continue;
    const sign = owner === zone.id ? -1 : 1;
    const normal = outward[port.side];
    return { x: sign * normal.x, y: sign * normal.y };
  }
  const dx = neighbor.x - point.x, dy = neighbor.y - point.y;
  return Math.abs(dx) >= Math.abs(dy) ? { x: Math.sign(dx), y: 0 } : { x: 0, y: Math.sign(dy) };
}

const compact = (points: Point[]) => points.filter((p, i) => !i || !same(p, points[i - 1]))
  .filter((p, i, path) => !i || i === path.length - 1 ||
    !((path[i - 1].x === p.x && p.x === path[i + 1].x) || (path[i - 1].y === p.y && p.y === path[i + 1].y)));

// Labels have finished placement. They are immutable obstacles here, including
// an edge's own pill. Each hierarchical section stays in its original region;
// fixed normal leads make both sides of every boundary port perpendicular.
export function routeTextObstacles(scene: Scene, extra: Box[] = []) {
  const text = [...textObstacles(scene), ...extra];
  for (const edge of scene.edges) edge.sections = edge.sections.map((original, index) => {
    const points = compact(original);
    if (points.length < 2) return points;
    const owner = edge.sectionOwners?.[index];
    const region = scene.containers.find((zone) => zone.id === owner);
    const ancestors = new Set<string>();
    for (let id = region?.id; id !== undefined; id = scene.containers.find((zone) => zone.id === id)?.parent) ancestors.add(id);
    const boxes = [...text.filter((box) => !edge.labels.some((label) => label.onRoute && label.box === box)),
      ...scene.nodes.filter((node) => node.id !== edge.source && node.id !== edge.target).map((node) => node.box),
      ...scene.containers.filter((zone) => !zone.sequence && !ancestors.has(zone.id)).map((zone) => zone.box)];
    const start = points[0], end = points.at(-1)!;
    const startNormal = normalAt(scene, edge, start, points[1], owner);
    const endNormal = normalAt(scene, edge, end, points.at(-2)!, owner);
    const aligned = (a: Point, b: Point, normal: Point) =>
      normal.x ? a.y === b.y && (b.x - a.x) * normal.x > 0 : a.x === b.x && (b.y - a.y) * normal.y > 0;
    const clear = (path: Point[]) => path.slice(1).every((b, i) => !boxes.some((box) => segmentCrossesBox(path[i], b, box)));
    if (aligned(start, end, startNormal) && aligned(end, start, endNormal) && clear([start, end])) return [start, end];
    if (aligned(start, points[1], startNormal) && aligned(end, points.at(-2)!, endNormal) && clear(points)) return points;
    const bounds = region ? { x: region.box.x + 4, y: region.box.y + 4,
      width: region.box.width - 8, height: region.box.height - 8 }
      : { x: 0, y: 0, width: scene.width, height: scene.height };
    const side = (normal: Point): PortSide => normal.x ? normal.x > 0 ? "EAST" : "WEST" : normal.y > 0 ? "SOUTH" : "NORTH";
    // Preserve the text margin used by the former exit search. A line touching
    // another edge's fallback pill would make label ownership ambiguous.
    const searchBoxes = boxes.map((box) => ({ x: box.x - 8, y: box.y - 8, width: box.width + 16, height: box.height + 16 }));
    const path = orthogonalRoute({ point: start, side: side(startNormal) }, { point: end, side: side(endNormal) }, searchBoxes, bounds, [], [],
      { padding: 0, maxDetour: Infinity });
    if (!path) {
      layoutCompromise(scene, edge.id, `route cannot avoid text in section ${index} (${owner ?? "root"})`);
      return points;
    }
    const routed = compact(path);
    if (!clear(routed)) {
      layoutCompromise(scene, edge.id, `text blocks an endpoint in section ${index} (${owner ?? "root"})`);
      return points;
    }
    return routed;
  });
}

// Canvas text lives above the translated diagram. Include its measured boxes
// in the same final routing check instead of relying on a visual assumption.
export function canvasObstacles(title: TextBlock, diagramY: number, width: number, legendWidth: number, legendHeight: number): Box[] {
  return [{ x: 0, y: 24 - diagramY, width: title.width, height: title.height },
    ...(legendWidth ? [{ x: width - 48 - legendWidth, y: 24 - diagramY, width: legendWidth, height: legendHeight }] : [])];
}
