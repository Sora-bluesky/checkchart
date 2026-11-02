import type { Direction } from "../../ir.ts";
import { layoutCompromise, onOutline, overlaps, tabBox, type Box, type Label, type Point, type Scene, type SvgEdge } from "./scene.ts";
import { edgePairs } from "./line-routing.ts";

const gap = 4;
const nodeGap = 16;
const contains = (outer: Box, inner: Box) => inner.x >= outer.x && inner.y >= outer.y &&
  inner.x + inner.width <= outer.x + outer.width && inner.y + inner.height <= outer.y + outer.height;
const distance = (box: Box, a: Point, b: Point) => Math.hypot(
  Math.max(box.x - Math.max(a.x, b.x), Math.min(a.x, b.x) - box.x - box.width, 0),
  Math.max(box.y - Math.max(a.y, b.y), Math.min(a.y, b.y) - box.y - box.height, 0));
const flat = (sections: Point[][]) => sections.flat().filter((p, i, all) => !i || p.x !== all[i - 1].x || p.y !== all[i - 1].y)
  .filter((p, i, all) => !i || i === all.length - 1 ||
    !(all[i - 1].x === p.x && p.x === all[i + 1].x || all[i - 1].y === p.y && p.y === all[i + 1].y));
const segmentsOf = (scene: Scene) => scene.edges.flatMap((edge) => {
  const points = flat(edge.sections);
  // A compromised self route may collapse to its endpoint. Its label must
  // still use that geometry rather than retaining an old ELK reservation.
  if (points.length === 1) return [{ a: points[0], b: points[0], edge }];
  return points.slice(1).map((b, i) => ({ a: points[i], b, edge }));
});
const hasAffinity = (box: Box, edge: SvgEdge, segments: ReturnType<typeof segmentsOf>) => {
  const own = Math.min(...segments.filter((segment) => segment.edge === edge).map(({ a, b }) => distance(box, a, b)));
  return Number.isFinite(own) && segments.filter((segment) => segment.edge !== edge).every(({ a, b }) => distance(box, a, b) > own + 0.04);
};

// Reserve the label's extent between the two children of its common ancestor.
// Move whole subtrees and following siblings; nested containment stays intact.
export function reserveCrossZoneLabelSpace(scene: Scene, direction: Direction) {
  const items = [...scene.nodes, ...scene.containers];
  const chain = (id: string | undefined): string[] => {
    const ids: string[] = [];
    for (let item = items.find((item) => item.id === id); item; item = items.find((parent) => parent.id === item.parent)) ids.push(item.id);
    return [...ids, "root"];
  };
  const shiftFollowing = (parent: string, axis: "x" | "y", start: number, delta: number) => {
    const moving = items.filter((item) => (item.parent ?? "root") === parent && item.box[axis] >= start).map((item) => item.id);
    for (const item of items) if (moving.some((id) => chain(item.id).includes(id))) item.box[axis] += delta;
    for (const edge of scene.edges) if (moving.some((id) => chain(edge.source).includes(id) && chain(edge.target).includes(id))) {
      for (const label of edge.labels) label.box[axis] += delta;
    }
  };
  const requests = scene.edges.filter((edge) => edge.labels.length).map((edge) => {
    const from = chain(edge.source), to = chain(edge.target), common = from.slice(1).find((id) => to.slice(1).includes(id))!;
    return { edge, common, from: from[from.indexOf(common) - 1], to: to[to.indexOf(common) - 1], depth: chain(common).length };
  }).sort((a, b) => b.depth - a.depth);
  for (const { edge, common, from, to } of requests) {
    const a = items.find((item) => item.id === from), b = items.find((item) => item.id === to);
    if (!a || !b || a === b || !scene.containers.some((zone) => zone === a || zone === b)) continue;
    const axes = direction === "LR" || direction === "RL" ? ["x", "y"] as const : ["y", "x"] as const;
    for (const axis of axes) {
      const extent = axis === "x" ? "width" : "height";
      const [first, second] = a.box[axis] < b.box[axis] ? [a, b] : [b, a];
      const available = second.box[axis] - first.box[axis] - first.box[extent];
      if (available < 0) continue;
      const needed = Math.max(...edge.labels.map((label) => label.box[extent])) + gap * 2;
      const delta = needed - available;
      if (delta > 0.01) {
        shiftFollowing(common, axis, second.box[axis], delta);
        for (const id of chain(common)) {
          const zone = scene.containers.find((zone) => zone.id === id);
          if (!zone) continue;
          shiftFollowing(zone.parent ?? "root", axis, zone.box[axis] + zone.box[extent], delta);
          zone.box[extent] += delta;
        }
        scene[extent] += delta;
      }
      break;
    }
  }
}

// Freeze each label against its finished route. Later arrows treat this pill as
// an obstacle; no later pass may move the labelled arrow away from its pill.
export function placeEdgeLabels(scene: Scene, direction: Direction, selected: SvgEdge[], protectedSegments: [Point, Point][] = [], outerSide: (a: Point, b: Point) => number = () => 0,
  alreadyPlaced = scene.edges.filter((edge) => edge.sections.length)) {
  const horizontal = direction === "LR" || direction === "RL";
  const segments = segmentsOf(scene);
  const pairs = edgePairs(scene.edges);
  const placed: Label[] = alreadyPlaced.filter((edge) => !selected.includes(edge)).flatMap((edge) => edge.labels);
  const labels = selected.flatMap((edge) => edge.labels.map((label) => ({ label, edge })));
  // Large pills have fewer legal positions. Do not consume their only slot with
  // a small label that could fit elsewhere along its line.
  labels.sort((a, b) => b.label.box.width * b.label.box.height - a.label.box.width * a.label.box.height);
  for (const { label, edge } of labels) {
    delete label.onRoute;
    scene.warnings = scene.warnings.filter((warning) => warning.rule !== "LayoutCompromise" || !warning.detail.startsWith(`${edge.id} label `));
    const own = segments.filter((segment) => segment.edge === edge);
    const source = scene.nodes.find((node) => node.id === edge.source)?.box;
    const target = scene.nodes.find((node) => node.id === edge.target)?.box;
    const common = scene.containers.filter((zone) => source && target && contains(zone.box, source) && contains(zone.box, target));
    const crossed = scene.containers.filter((zone) => !common.includes(zone));
    let travelled = 0;
    const anchors = own.flatMap(({ a, b }) => {
      const h = a.y === b.y, axis = h ? "x" : "y", across = h ? "y" : "x", extent = h ? "width" : "height", depth = h ? "height" : "width";
      const low = Math.min(a[axis], b[axis]), high = Math.max(a[axis], b[axis]);
      const cuts = [...new Set([low, high, ...scene.containers.filter(({ box }) => a[across] >= box[across] && a[across] <= box[across] + box[depth])
        .flatMap(({ box }) => [box[axis], box[axis] + box[extent]]).filter((value) => value > low && value < high)])].sort((a, b) => a - b);
      const start = travelled;
      travelled += high - low;
      return cuts.slice(1).map((end, i) => {
        const begin = cuts[i], mid = { ...a, [axis]: (begin + end) / 2 };
        const rank = crossed.length && crossed.every((zone) => !contains(zone.box, { ...mid, width: 0, height: 0 })) ? 0
          : common.some((zone) => contains(zone.box, { ...mid, width: 0, height: 0 })) ? 1 : 2;
        return { a: { ...a, [axis]: begin }, b: { ...b, [axis]: end }, rank, start, origin: a, axis, sign: Math.sign(b[axis] - a[axis]) };
      });
    });
    const bestRank = Math.min(...anchors.map((anchor) => anchor.rank));
    const longest = Math.max(...anchors.map(({ a, b }) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y)));
    const boxes = [...scene.nodes.map((node) => node.id === edge.source || node.id === edge.target ? node.box
      : { x: node.box.x - nodeGap + gap, y: node.box.y - nodeGap + gap, width: node.box.width + (nodeGap - gap) * 2, height: node.box.height + (nodeGap - gap) * 2 }), ...scene.notes.map((note) => note.box),
      ...scene.containers.map(tabBox), ...placed.map((label) => label.box)];
    const candidates: { box: Box; rank: number; orientation: number; length: number; overflow: number; cost: number }[] = [];
    for (const eligible of [anchors.filter((anchor) => anchor.rank === bestRank), anchors]) {
      for (const { a, b, rank, start, origin, axis: alongAxis, sign } of eligible) {
        const h = a.y === b.y, extent = h ? label.box.width : label.box.height;
        const low = h ? Math.min(a.x, b.x) : Math.min(a.y, b.y), high = h ? Math.max(a.x, b.x) : Math.max(a.y, b.y);
        const axis = h ? a.y : a.x;
        const positions = new Set([(low + high - extent) / 2, low + gap, high - extent - gap]);
        if (rank === 2) positions.add(Math.max(low, Math.min(high - extent, origin[alongAxis] + sign * (travelled / 2 - start) - extent / 2)));
        for (const box of [...boxes, ...scene.containers.map((zone) => zone.box)]) {
          positions.add((h ? box.x : box.y) - extent - gap);
          positions.add((h ? box.x + box.width : box.y + box.height) + gap);
        }
        for (const segment of segments) for (const point of [segment.a, segment.b]) {
          positions.add((h ? point.x : point.y) - extent - gap);
          positions.add((h ? point.x : point.y) + gap);
        }
        for (const position of positions) {
          if (position + extent < low || position > high) continue;
          for (const side of [-1, 1]) {
            const across = h ? label.box.height : label.box.width;
            const cross = axis + (side < 0 ? -across - gap : gap);
            const box = { ...label.box, x: h ? position : cross, y: h ? cross : position };
            if (!hasAffinity(box, edge, segments)) continue;
            if (rank === 0 && crossed.some((zone) => overlaps(zone.box, box))) continue;
            if (rank === 1 && !common.some((zone) => contains(zone.box, box))) continue;
            if (boxes.some((other) => overlaps(box, other, gap - 0.01))) continue;
            if (scene.containers.some((zone) => overlaps(zone.box, box) && !contains(zone.box, box))) continue;
            if (segments.some((segment) => distance(box, segment.a, segment.b) < gap - 0.01)) continue;
            if (protectedSegments.some(([a, b]) => distance(box, a, b) < gap - 0.01)) continue;
            const pair = pairs.find((pair) => pair.includes(edge));
            if (pair?.length === 2 && segments.some((s) => s.edge !== edge && pair.includes(s.edge) && (h ? s.a.y === s.b.y : s.a.x === s.b.x) &&
              (h ? s.a.y : s.a.x) * side > axis * side && (h ? s.a.y : s.a.x) * side < (cross + across / 2) * side)) continue;
            const offset = rank === 2 ? Math.abs(start + Math.abs(position + extent / 2 - origin[alongAxis]) - travelled / 2)
              : Math.abs(position + extent / 2 - (low + high) / 2);
            const middle = source && target ? h ? (source.y + source.height / 2 + target.y + target.height / 2) / 2
              : (source.x + source.width / 2 + target.x + target.width / 2) / 2 : axis;
            const preferredSide = outerSide(a, b) || Math.sign(axis - middle);
            candidates.push({ box, rank, orientation: rank === 2 ? 0 : Number(h !== horizontal), length: rank === 2 ? 0 : high - low,
              overflow: bestRank === 2 ? 0 : Math.max(0, -box.x) + Math.max(0, -box.y) + Math.max(0, box.x + box.width - scene.width) + Math.max(0, box.y + box.height - scene.height),
              cost: offset + (side * preferredSide < 0 ? longest : 0) });
          }
        }
      }
      if (candidates.length) break;
    }
    candidates.sort((a, b) => a.overflow - b.overflow || a.orientation - b.orientation || b.length - a.length || a.cost - b.cost);
    if (candidates.length) {
      label.box = candidates[0].box;
      if (candidates[0].rank !== bestRank) layoutCompromise(scene, edge.id, "label uses a nonpreferred zone segment");
    } else {
      // routeLayout first tries making room. If that cannot resolve placement,
      // keep the pill on its own longest segment, never beside another arrow.
      const longest = [...own].sort((a, b) => Math.abs(b.a.x - b.b.x) + Math.abs(b.a.y - b.b.y) - Math.abs(a.a.x - a.b.x) - Math.abs(a.a.y - a.b.y));
      const segment = longest[0];
      if (segment) {
        const { a, b } = segment, h = a.y === b.y;
        const extent = h ? label.box.width : label.box.height;
        const low = h ? Math.min(a.x, b.x) : Math.min(a.y, b.y), high = h ? Math.max(a.x, b.x) : Math.max(a.y, b.y);
        const positions = [(low + high - extent) / 2, low + gap, high - extent - gap];
        for (const { a, b } of segments) for (const point of [a, b]) positions.push((h ? point.x : point.y) + gap, (h ? point.x : point.y) - extent - gap);
        const alternatives = positions.filter((p) => p >= low && p + extent <= high).map((p) => ({ ...label.box,
          x: h ? p : a.x - label.box.width / 2, y: h ? a.y - label.box.height / 2 : p }));
        label.box = alternatives.find((box) => hasAffinity(box, edge, segments) && !boxes.some((other) => overlaps(box, other, gap)))
          ?? alternatives.find((box) => hasAffinity(box, edge, segments))
          ?? { ...label.box, x: (a.x + b.x - label.box.width) / 2, y: (a.y + b.y - label.box.height) / 2 };
      }
      label.onRoute = true;
      layoutCompromise(scene, edge.id, "label cannot meet affinity or placement clearance; placed on its longest segment");
    }
    placed.push(label);
  }
}

// Insert space without changing route topology. Every boundary port and crossed
// box moves with the same cut; no edge can become detached from its zone.
function openLabelGap(scene: Scene, axis: "x" | "y", cut: number, delta: number) {
  const extent = axis === "x" ? "width" : "height";
  for (const { box } of [...scene.nodes, ...scene.containers, ...scene.notes]) {
    if (box[axis] >= cut) box[axis] += delta;
    else if (box[axis] + box[extent] > cut) box[extent] += delta;
  }
  const points = new Set([...scene.edges.flatMap((edge) => edge.sections.flat()), ...scene.containers.flatMap((zone) => (zone.ports ?? []).map((port) => port.point))]);
  for (const point of points) if (point[axis] >= cut) point[axis] += delta;
  for (const edge of scene.edges) for (const [id, section, index, neighbor] of [
    [edge.source, edge.sections[0], 0, 1], [edge.target, edge.sections.at(-1), -1, -2],
  ] as const) {
    const node = scene.nodes.find((node) => node.id === id), point = section?.at(index), next = section?.at(neighbor);
    if (node && point && next) Object.assign(point, onOutline(node, point, next));
  }
  scene[extent] += delta;
}

export function recoverEdgeLabelSpace(scene: Scene, direction: Direction): Scene {
  const failed = (drawing: Scene) => {
    const segments = segmentsOf(drawing);
    return drawing.edges.flatMap((edge) => edge.labels.filter((label) => label.onRoute || !hasAffinity(label.box, edge, segments)).map((label) => ({ edge, label })));
  };
  const score = (drawing: Scene) => {
    const segments = segmentsOf(drawing), labels = drawing.edges.flatMap((edge) => edge.labels.map((label) => ({ edge, label })));
    return [labels.filter(({ edge, label }) => !hasAffinity(label.box, edge, segments)).length, labels.filter(({ label }) => label.onRoute).length];
  };
  // Each failed label gets the finite set of cuts implied by its segments and
  // neighbouring parallel lanes, plus a cut to lengthen each segment if needed.
  const requests = failed(scene).map(({ edge, label }) => ({ edge: edge.id, label: label.id }));
  for (const request of requests) {
    const item = failed(scene).find(({ label }) => label.id === request.label);
    if (!item) continue;
    const segments = segmentsOf(scene), cuts: { axis: "x" | "y"; cut: number; delta: number }[] = [];
    for (const { a, b } of segments.filter((segment) => segment.edge === item.edge)) {
      const h = a.y === b.y, axis = h ? "y" : "x", along = h ? "x" : "y";
      const across = h ? item.label.box.height : item.label.box.width;
      for (const side of [-1, 1]) {
        const neighbours = segments.filter((s) => s.edge !== item.edge && (s.a.y === s.b.y) === h &&
          (s.a[axis] - a[axis]) * side > 0.01 && Math.min(Math.max(a[along], b[along]), Math.max(s.a[along], s.b[along])) >=
          Math.max(Math.min(a[along], b[along]), Math.min(s.a[along], s.b[along])));
        const near = neighbours.sort((s, t) => Math.abs(s.a[axis] - a[axis]) - Math.abs(t.a[axis] - a[axis]))[0];
        if (near) {
          const delta = across + gap * 2 + 1 - Math.abs(near.a[axis] - a[axis]);
          if (delta > 0.01) cuts.push({ axis, cut: (a[axis] + near.a[axis]) / 2, delta });
        }
      }
      const delta = (h ? item.label.box.width : item.label.box.height) + gap * 2 - Math.abs(a[along] - b[along]);
      if (delta > 0.01) cuts.push({ axis: along, cut: (a[along] + b[along]) / 2, delta });
    }
    cuts.sort((a, b) => a.delta - b.delta);
    const base = scene, trials = cuts.map((cut) => [cut]);
    // A pill on a trapped lane can need clearance on both sides at once.
    // Descending cuts retain their original coordinates as space is inserted.
    if (cuts.length > 1) trials.push([...cuts].sort((a, b) => a.axis.localeCompare(b.axis) || b.cut - a.cut));
    for (const trial of trials) {
      const candidate = structuredClone(base);
      for (const { axis, cut, delta } of trial) openLabelGap(candidate, axis, cut, delta);
      placeEdgeLabels(candidate, direction, candidate.edges);
      const before = score(scene), after = score(candidate);
      if (after[0] < before[0] || after[0] === before[0] && after[1] < before[1]) scene = candidate;
      if (!failed(scene).some(({ label }) => label.id === request.label)) break;
    }
  }
  return scene;
}

export function fitEdgeLabels(scene: Scene) {
  const allBoxes = [...scene.nodes, ...scene.containers, ...scene.edges.flatMap((edge) => edge.labels)].map((item) => item.box);
  const points = new Set([...scene.edges.flatMap((edge) => edge.sections.flat()), ...scene.containers.flatMap((zone) => (zone.ports ?? []).map((port) => port.point))]);
  // ELK label reservations can leave empty strips after final label placement.
  // Fit the actual geometry by translation, including every route and port.
  const dx = 12 - Math.min(...allBoxes.map((box) => box.x), ...[...points].map((p) => p.x));
  const dy = 12 - Math.min(...allBoxes.map((box) => box.y), ...[...points].map((p) => p.y));
  for (const box of allBoxes) { box.x += dx; box.y += dy; }
  for (const point of points) { point.x += dx; point.y += dy; }
  scene.width = Math.max(1, ...allBoxes.map((box) => box.x + box.width + 12), ...[...points].map((p) => p.x + 12));
  scene.height = Math.max(1, ...allBoxes.map((box) => box.y + box.height + 12), ...[...points].map((p) => p.y + 12));
}
