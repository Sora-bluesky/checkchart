import type { Box, Point } from "../backends/svg/scene.ts";
import type { Model } from "../ir.ts";

type Edge = { id: string; source?: string; target?: string; points: Point[]; bends: number };
const near = (a: number, b: number) => Math.abs(a - b) < 0.03;
const length = (a: Point, b: Point) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
const boxOf = (s: string): Box => { const [x, y, width, height] = s.split(" ").map(Number); return { x, y, width, height }; };
const contains = (box: Box, p: Point) => p.x >= box.x - 0.03 && p.y >= box.y - 0.03 && p.x <= box.x + box.width + 0.03 && p.y <= box.y + box.height + 0.03;
const inflate = (b: Box, n: number): Box => ({ x: b.x - n, y: b.y - n, width: b.width + n * 2, height: b.height + n * 2 });
const crosses = (a: Point, b: Point, box: Box) => Math.max(a.x, b.x) > box.x + 0.03 && Math.min(a.x, b.x) < box.x + box.width - 0.03 &&
  Math.max(a.y, b.y) > box.y + 0.03 && Math.min(a.y, b.y) < box.y + box.height - 0.03;
const normal = (p: Point, q: Point) => near(p.x, q.x) ? { x: 0, y: Math.sign(q.y - p.y) } : { x: Math.sign(q.x - p.x), y: 0 };
const outward = (p: Point, q: Point, n: Point) => (n.x ? near(p.y, q.y) : near(p.x, q.x)) && (q.x - p.x) * n.x + (q.y - p.y) * n.y > 0;
const intersects = (a: Point, b: Point, p: Point, q: Point) => {
  const v = near(a.x, b.x);
  if (v === near(p.x, q.x)) return false;
  const x = v ? a.x : p.x, y = v ? p.y : a.y;
  return x >= Math.max(Math.min(a.x, b.x), Math.min(p.x, q.x)) - 0.03 && x <= Math.min(Math.max(a.x, b.x), Math.max(p.x, q.x)) + 0.03 &&
    y >= Math.max(Math.min(a.y, b.y), Math.min(p.y, q.y)) - 0.03 && y <= Math.min(Math.max(a.y, b.y), Math.max(p.y, q.y)) + 0.03;
};

// Independent SVG audit. Search by number of segments, with no production
// router, port allocator or distance/bend weighting in the oracle.
export function auditBends(svg: string, model: Model, edges: Edge[]) {
  const violations: string[] = [], exceptions: { edge: string; reason: string }[] = [];
  const minima = new Map<string, number>();
  if (model.kind === "sequence") {
    for (const edge of edges) {
      minima.set(edge.id, near(edge.points[0].x, edge.points.at(-1)!.x) && !near(edge.points[0].y, edge.points.at(-1)!.y) ? 2 : 0);
      if (edge.bends > (minima.get(edge.id) ?? 0)) violations.push(`${edge.id}: sequence arrow has needless bends`);
    }
    exceptions.push({ edge: "sequence", reason: "Message endpoints are lifelines at message rows; participant-box overlap does not select their ports." });
    return { violations, exceptions, minima };
  }
  const nodes = new Map([...svg.matchAll(/id="node-([^"]+)"[^>]*data-node="([^"]+)"/g)].map((m) => [m[1], boxOf(m[2])]));
  const diamonds = new Set([...svg.matchAll(/id="node-([^"]+)" class="node decision /g)].map((m) => m[1]));
  const zones = [...svg.matchAll(/data-container="([^"]+)"/g)].map((m) => boxOf(m[1]));
  const tabs = [...svg.matchAll(/data-tab="([^"]+)"/g)].map((m) => inflate(boxOf(m[1]), 4));
  const notes = [...svg.matchAll(/data-note="([^"]+)"/g)].map((m) => inflate(boxOf(m[1]), 4));
  const pills = [...svg.matchAll(/id="label-([^"]+)-label" data-pill="([^"]+)"/g)].map((m) => ({ edge: m[1], box: inflate(boxOf(m[2]), 4) }));
  const decisions = new Set(model.kind === "flow" ? Object.values(model.nodes).flatMap((node, i) => node.type === "decision" ? [`n${i}`] : []) : []);
  for (const edge of edges) {
    const a = edge.points[0], b = edge.points.at(-1)!;
    if (edge.source === edge.target && decisions.has(edge.source ?? "") && length(a, b) < 0.03) {
      minima.set(edge.id, 4);
      if (edge.bends > 4) violations.push(`${edge.id}: closed decision loop has needless bends`);
      exceptions.push({ edge: edge.id, reason: "A decision self-loop closes on one free vertex; its Manhattan distance is zero." });
      continue;
    }
    const source = nodes.get(edge.source ?? ""), target = nodes.get(edge.target ?? "");
    if (!source || !target) {
      exceptions.push({ edge: edge.id, reason: "Synthetic SVG has no declared endpoint boxes." });
      continue;
    }
    const n = normal(a, edge.points[1]), m = normal(b, edge.points.at(-2)!);
    const faceEnds = (e: Edge) => [{ id: e.source, p: e.points[0], n: normal(e.points[0], e.points[1]) },
      { id: e.target, p: e.points.at(-1)!, n: normal(e.points.at(-1)!, e.points.at(-2)!) }];
    const ownEnds = faceEnds(edge);
    const peers = edges.filter((peer) => peer !== edge && faceEnds(peer).some((p) => ownEnds.some((q) => p.id === q.id && p.n.x === q.n.x && p.n.y === q.n.y)));
    const forbidden = peers.flatMap((peer) => peer.points.slice(1).map((q, i) => [peer.points[i], q]));
    const boxContains = (zone: Box, node: Box) => contains(zone, node) && contains(zone, { x: node.x + node.width, y: node.y + node.height });
    const related = zones.filter((z) => boxContains(z, source) || boxContains(z, target));
    const common = related.filter((z) => boxContains(z, source) && boxContains(z, target));
    const obstacles = [...[...nodes].filter(([id]) => id !== edge.source && id !== edge.target).map(([, box]) => inflate(box, 12)),
      ...zones.filter((z) => !related.includes(z)).map((z) => inflate(z, 12)), ...tabs, ...notes,
      ...pills.filter((p) => p.edge !== edge.id).map((p) => p.box)];
    const reasons = new Set<string>();
    const segmentFree = (p: Point, q: Point) => {
      if (obstacles.some((box) => crosses(p, q, box))) { reasons.add("node, tab, label or unrelated zone obstacle"); return false; }
      if (forbidden.some(([r, s]) => intersects(p, q, r, s))) { reasons.add("ordered routes on a shared face"); return false; }
      for (const z of common) if (!contains(inflate(z, -12), p) || !contains(inflate(z, -12), q)) { reasons.add("common zone bounds"); return false; }
      for (const z of related) {
        const v = near(p.x, q.x), low = v ? Math.min(p.y, q.y) : Math.min(p.x, q.x), high = v ? Math.max(p.y, q.y) : Math.max(p.x, q.x);
        const overlap = Math.min(high, v ? z.y + z.height : z.x + z.width) - Math.max(low, v ? z.y : z.x);
        if (overlap > 0.03 && (v ? [z.x, z.x + z.width] : [z.y, z.y + z.height]).some((value) => Math.abs((v ? p.x : p.y) - value) < 12 - 0.03)) {
          reasons.add("12px border clearance"); return false;
        }
      }
      return true;
    };
    const legal = (points: Point[], startNormal = n, endNormal = m) => {
      if (!outward(points[0], points[1], startNormal) || !outward(points.at(-1)!, points.at(-2)!, endNormal)) return false;
      for (let i = 1; i < points.length; i++) {
        const p = points[i - 1], q = points[i];
        if (length(p, q) < (points.length > 2 && (i === 1 || i === points.length - 1) ? 24 : 16) - 0.03) { reasons.add("minimum jog or normal lead"); return false; }
        if (!segmentFree(p, q) || i > 1 && crosses(p, q, source) || i < points.length - 1 && crosses(p, q, target)) return false;
      }
      for (const z of related.filter((z) => !common.includes(z))) {
        let hits = 0;
        for (let i = 1; i < points.length; i++) {
          const p = points[i - 1], q = points[i];
          if (near(p.x, q.x) && p.x > z.x && p.x < z.x + z.width) {
            hits += [z.y, z.y + z.height].filter((y) => y > Math.min(p.y, q.y) + 0.03 && y < Math.max(p.y, q.y) - 0.03).length;
          } else if (near(p.y, q.y) && p.y > z.y && p.y < z.y + z.height) {
            hits += [z.x, z.x + z.width].filter((x) => x > Math.min(p.x, q.x) + 0.03 && x < Math.max(p.x, q.x) - 0.03).length;
          }
        }
        if (hits > 1) { reasons.add("one crossing per zone"); return false; }
      }
      return true;
    };
    let minimum = Infinity;
    // Box overlap establishes a straight lane before spreading. Diamond
    // vertices and existing parallel lanes are the explicit port constraints.
    if (edge.source !== edge.target) {
      const v = !["LR", "RL"].includes(model.direction), axis = v ? "x" : "y", extent = v ? "width" : "height";
      const low = Math.max(source[axis], target[axis]), high = Math.min(source[axis] + source[extent], target[axis] + target[extent]);
      const ds = [edge.source!, edge.target!].filter((id) => diamonds.has(id));
      const value = ds.length ? nodes.get(ds[0])![axis] + nodes.get(ds[0])![extent] / 2 : (low + high) / 2;
      const alignedVertices = ds.every((id) => near(nodes.get(id)![axis] + nodes.get(id)![extent] / 2, value));
      const sign = Math.sign(v ? target.y - source.y : target.x - source.x);
      const pair = edges.some((peer) => peer !== edge && [edge.source, edge.target].every((id) => id === peer.source || id === peer.target));
      const candidates = [value, ...(ds.length ? [] : [low + 16, high - 16, a[axis], b[axis],
        ...obstacles.flatMap((box) => [box[axis], box[axis] + box[extent]]),
        ...peers.flatMap((peer) => faceEnds(peer).flatMap((end) => [end.p[axis] - 24, end.p[axis] + 24]))]
        .filter((candidate) => candidate >= low + 16 - 0.03 && candidate <= high - 16 + 0.03))];
      for (const candidate of [...new Set(candidates)]) {
        const p = v ? { x: candidate, y: sign > 0 ? source.y + source.height : source.y } : { x: sign > 0 ? source.x + source.width : source.x, y: candidate };
        const q = v ? { x: candidate, y: sign > 0 ? target.y : target.y + target.height } : { x: sign > 0 ? target.x : target.x + target.width, y: candidate };
        const vertexTaken = ds.some((id) => edges.some((peer) => peer !== edge && faceEnds(peer).some((end) => end.id === id && length(end.p, id === edge.source ? p : q) < 0.03)));
        const ordered = ownEnds.every((end) => edges.filter((peer) => peer !== edge).every((peer) => faceEnds(peer).every((other) => {
          if (end.id !== other.id || other.n[axis] !== 0 || (other.n.x || other.n.y) !== (end.id === edge.source ? sign : -sign)) return true;
          const ownPeer = end.id === edge.source ? target : source;
          const peerBox = nodes.get(other.id === peer.source ? peer.target ?? "" : peer.source ?? "");
          if (!peerBox) return true;
          const order = Math.sign(ownPeer[axis] + ownPeer[extent] / 2 - peerBox[axis] - peerBox[extent] / 2) || Math.sign(end.p[axis] - other.p[axis]);
          return (candidate - other.p[axis]) * order >= 24 - 0.03;
        })));
        if (high - low >= 16 - 0.03 && alignedVertices && candidate >= low && candidate <= high && !pair && !vertexTaken && ordered &&
          legal([p, q], v ? { x: 0, y: sign } : { x: sign, y: 0 }, v ? { x: 0, y: -sign } : { x: -sign, y: 0 })) {
          minimum = 0;
          if (edge.bends || candidate === value && !near(a[axis], value) || candidate !== value && (a[axis] < low + 16 - 0.03 || a[axis] > high - 16 + 0.03)) {
            violations.push(`${edge.id}: shared overlap has a free straight lane at ${candidate}; got ${edge.bends} bends at ${a[axis]}`);
          }
          break;
        }
      }
    }
    if (legal([a, b])) minimum = 0;
    for (const corner of [{ x: a.x, y: b.y }, { x: b.x, y: a.y }]) if (legal([a, corner, b])) minimum = Math.min(minimum, 1);
    const xs = [...new Set([a.x, b.x, (a.x + b.x) / 2, a.x - 24, a.x + 24, b.x - 24, b.x + 24,
      ...obstacles.flatMap((box) => [box.x, box.x + box.width]), ...related.flatMap((box) => [box.x - 12, box.x + 12, box.x + box.width - 12, box.x + box.width + 12])])];
    const ys = [...new Set([a.y, b.y, (a.y + b.y) / 2, a.y - 24, a.y + 24, b.y - 24, b.y + 24,
      ...obstacles.flatMap((box) => [box.y, box.y + box.height]), ...related.flatMap((box) => [box.y - 12, box.y + 12, box.y + box.height - 12, box.y + box.height + 12])])];
    if (minimum > 1) {
      for (const x of xs) if (legal([a, { x, y: a.y }, { x, y: b.y }, b])) minimum = 2;
      for (const y of ys) if (legal([a, { x: a.x, y }, { x: b.x, y }, b])) minimum = 2;
    }
    if (minimum > 2) {
      // Breadth first visibility search proves the obstacle exception instead
      // of accepting a long route simply because it has more than two bends.
      const pending = [{ points: [a], axis: 0 }], seen = new Set<string>();
      for (let i = 0; i < pending.length; i++) {
        const { points, axis } = pending[i], p = points.at(-1)!;
        if (points.length > edge.bends + 2) break;
        if (points.length > 1 && near(p.x, b.x) && near(p.y, b.y) && legal(points)) { minimum = points.length - 2; break; }
        for (const q of [...xs.map((x) => ({ x, y: p.y })), ...ys.map((y) => ({ x: p.x, y }))]) {
          const nextAxis = near(p.x, q.x) ? 2 : 1;
          if (axis === nextAxis || length(p, q) < 16 - 0.03 || !segmentFree(p, q)) continue;
          if (!axis && (!outward(a, q, n) || length(a, q) < 24 - 0.03)) continue;
          if (points.length > 1 && crosses(p, q, source)) continue;
          const last = near(q.x, b.x) && near(q.y, b.y);
          if (!last && crosses(p, q, target) || last && (!outward(b, p, m) || length(p, b) < 24 - 0.03)) continue;
          const key = `${q.x},${q.y},${nextAxis}`;
          if (seen.has(key)) continue;
          seen.add(key); pending.push({ points: [...points, q], axis: nextAxis });
        }
      }
      exceptions.push({ edge: edge.id, reason: `No legal 0/1/2-bend route for these faces: ${[...reasons].join("; ") || "endpoint normals"}. Minimum ${minimum}.` });
    }
    minima.set(edge.id, minimum);
    if (!Number.isFinite(minimum) || edge.bends > minimum) violations.push(`${edge.id}: ${edge.bends} bends; minimum ${minimum} for its endpoints and faces`);
  }
  return { violations, exceptions, minima };
}
