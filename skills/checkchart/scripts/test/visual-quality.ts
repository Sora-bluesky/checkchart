import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { countCrossings } from "../backends/svg/crossings.ts";
import type { Box, Point } from "../backends/svg/scene.ts";
import { keyOf, labelOf, messagesOf, participantOrder, stepOf, type Answers, type Model } from "../ir.ts";
import { loadModel } from "../frontends/model.ts";
import { answersOf, loadView } from "../frontends/view.ts";
import { root, run } from "./helpers.ts";
import { auditBends } from "./svg-bend-geometry.ts";
import { textWidth, widthBudget } from "../backends/svg/text.ts";

const near = (a: number, b: number) => Math.abs(a - b) < 0.03;
const length = (a: Point, b: Point) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
const boxOf = (text: string): Box => {
  const [x, y, width, height] = text.split(" ").map(Number);
  assert.ok([x, y, width, height].every(Number.isFinite), "invalid visual bounds");
  return { x, y, width, height };
};
const compact = (points: Point[]) => points.filter((p, i) => !i || length(p, points[i - 1]) > 0.02)
  .filter((p, i, all) => !i || i === all.length - 1 ||
    !((near(all[i - 1].x, p.x) && near(p.x, all[i + 1].x) || near(all[i - 1].y, p.y) && near(p.y, all[i + 1].y)) &&
      (p.x - all[i - 1].x) * (all[i + 1].x - p.x) + (p.y - all[i - 1].y) * (all[i + 1].y - p.y) > 0));
type Segment = { a: Point; b: Point };

// Section boundaries and collinear visibility-grid points are not bends. Apply
// the same final-SVG invariant to ordinary and deliberately compromised charts.
export function assertSvgMinimumJog(svg: string) {
  for (const edge of svg.matchAll(/<g id="edge-([^\"]+)"[^>]*>(.*?)<\/g>/gs)) {
    const points = compact([...edge[2].matchAll(/data-points="([^\"]+)"/g)].flatMap((section) => section[1].split(" ").map((point) => {
      const [x, y] = point.split(",").map(Number);
      assert.ok(Number.isFinite(x) && Number.isFinite(y), "invalid jog route");
      return { x, y };
    })));
    if (points.length <= 2) continue;
    for (let i = 1; i < points.length; i++) assert.ok(length(points[i - 1], points[i]) >= 16 - 0.03,
      `${edge[1]} jog under 16px: segment ${i} is ${length(points[i - 1], points[i])}px`);
  }
}

// Compare emitted lines with authored text, independently of the wrap planner.
// Hard newlines are preserved; automatic cuts need a legal break opportunity
// and an over-budget source line. Cover nodes, edge labels and container tabs.
export function assertVisualText(svg: string, model: Model, answers: Answers) {
  const captions = new Map<string, string>();
  if (model.kind === "sequence") {
    const order = participantOrder(model, answers), groups = new Set<string>();
    for (const [index, id] of order.entries()) {
      const caption = labelOf(answers, "participant", id);
      captions.set(`node-p${index}`, caption);
      captions.set(`node-p${index}-footer`, caption);
      const group = answers.groups.get(keyOf({ kind: "participant", id }));
      if (group !== undefined && !groups.has(group)) {
        groups.add(group);
        captions.set(`container-group-${index}`, group);
      }
    }
    for (const [index, message] of messagesOf(model.messages).entries()) captions.set(`label-m${index}-label`, stepOf(answers, message) ?? "");
  } else {
    const kind = model.kind === "flow" ? "node" : "component";
    const facts = model.kind === "flow" ? model.nodes : model.components;
    for (const [index, id] of Object.keys(facts).entries()) captions.set(`node-n${index}`, labelOf(answers, kind, id));
    if (model.kind === "architecture") for (const [index, id] of Object.keys(model.zones).entries()) captions.set(`container-z${index}`, labelOf(answers, "zone", id));
    for (const [index, edge] of (model.kind === "flow" ? model.edges : model.connections).entries()) {
      const caption = stepOf(answers, edge);
      if (caption !== null) captions.set(`label-e${index}-label`, caption);
    }
  }
  const entities: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
  for (const match of svg.matchAll(/<g id="((?:node|container|label)-[^"]+)"([^>]*)>(.*?)<\/g>/gs)) {
    const id = match[1], attributes = match[2], body = match[3], caption = captions.get(id);
    assert.ok(caption !== undefined, `unmapped text ${id}`);
    const lines = [...body.matchAll(/<tspan\b[^>]*>(.*?)<\/tspan>/gs)].map((m) => m[1].replace(/&(amp|lt|gt|quot|apos);/g, (_, entity) => entities[entity]));
    const tab = id.startsWith("container-"), node = id.startsWith("node-");
    const budget = tab ? 320 : node ? 200 : 240;
    assert.doesNotMatch(body, /textLength=|lengthAdjust=/, `${id} shrinks text`);
    if (tab) {
      const zone = attributes.match(/data-container="([^"]+)"/), header = attributes.match(/data-tab="([^"]+)"/);
      assert.ok(zone && header, `${id} missing tab bounds`);
      assert.ok(boxOf(zone[1]).width >= boxOf(header[1]).width + 48 - 0.03, `${id} lacks the 48px tab reserve`);
    }
    let cursor = 0;
    for (const [index, authored] of caption.split(/\r\n|\r|\n/).entries()) {
      const source = authored.trim(), start = cursor;
      let offset = 0;
      do {
        const line = lines[cursor++];
        assert.notEqual(line, undefined, `${id} lost an authored line`);
        assert.ok(source.startsWith(line, offset), `${id} changed text: ${JSON.stringify(lines)}`);
        assert.ok(line.length || !source.length, `${id} inserted an empty line`);
        offset += line.length;
        if (offset < source.length) {
          assert.ok(source[offset] === " " || /[ 、。・：，）]/u.test(source[offset - 1]) || source[offset] === "（", `${id} word break: ${JSON.stringify(lines)}`);
          while (source[offset] === " ") offset++;
        }
      } while (offset < source.length);
      const name = node && index === 0;
      const size = tab ? 15 : name ? 16 : 13;
      if (cursor - start > 1) assert.ok(textWidth(source, size, tab || name ? 700 : 400, tab || name ? "sans" : "mono") > budget, `${id} wrapped below its ${budget}px budget`);
    }
    assert.equal(cursor, lines.length, `${id} added lines`);
  }
}

export function labelDistance(box: Box, { a, b }: Segment): number {
  const dx = Math.max(box.x - Math.max(a.x, b.x), Math.min(a.x, b.x) - box.x - box.width, 0);
  const dy = Math.max(box.y - Math.max(a.y, b.y), Math.min(a.y, b.y) - box.y - box.height, 0);
  return Math.hypot(dx, dy);
}

// Audit the emitted SVG, after all route, text and canvas passes have finished.
export function visualQuality(svg: string, model: Model, answers?: Answers) {
  assertSvgMinimumJog(svg);
  if (answers) assertVisualText(svg, model, answers);
  const decisions = new Set(model.kind === "flow" ? Object.values(model.nodes).flatMap((node, i) => node.type === "decision" ? [`n${i}`] : []) : []);
  const nodes = [...svg.matchAll(/<g id="node-([^"]+)"[^>]* data-node="([^"]+)"/g)]
    .map((m) => ({ id: m[1], box: boxOf(m[2]) }));
  const edges = [...svg.matchAll(/<g id="edge-([^"]+)"([^>]*)>(.*?)<\/g>/g)].map((m) => {
    const sections = [...m[3].matchAll(/data-points="([^"]+)"/g)].map((s) => s[1].split(" ").map((p) => {
      const [x, y] = p.split(",").map(Number);
      assert.ok(Number.isFinite(x) && Number.isFinite(y), "invalid visual route");
      return { x, y };
    }));
    for (const [i, section] of sections.entries()) {
      assert.ok(section.length >= 2, `${m[1]} has an empty section`);
      if (i) assert.ok(length(sections[i - 1].at(-1)!, section[0]) <= 0.02, `${m[1]} has a detached section`);
      for (let j = 1; j < section.length; j++) assert.ok(near(section[j - 1].x, section[j].x) || near(section[j - 1].y, section[j].y), `${m[1]} has a diagonal segment`);
    }
    const points = compact(sections.flat());
    assert.ok(points.length >= 2, `${m[1]} has no route`);
    const segments = points.slice(1).map((b, i) => ({ a: points[i], b }));
    const edgeLength = sections.reduce((sum, section) => sum + section.slice(1).reduce((total, b, i) => total + length(section[i], b), 0), 0);
    const direct = length(points[0], points.at(-1)!);
    const source = m[2].match(/data-source="([^"]+)"/)?.[1], target = m[2].match(/data-target="([^"]+)"/)?.[1];
    const detourExempt = direct === 0 && source === target && decisions.has(source ?? "");
    return { id: m[1], source, target, detourExempt,
      points, segments, sections, length: edgeLength, bends: points.length - 2,
      detour: direct ? edgeLength / direct : edgeLength ? Infinity : 1 };
  });
  const labels = [...svg.matchAll(/id="label-([^"]+)-label" data-pill="([^"]+)"/g)].map((m) => {
    const box = boxOf(m[2]), own = edges.find((edge) => edge.id === m[1]);
    assert.ok(own, `orphan visual label ${m[1]}`);
    const distance = Math.min(...own.segments.map((s) => labelDistance(box, s)));
    const other = Math.min(...edges.filter((edge) => edge !== own).flatMap((edge) => edge.segments.map((s) => labelDistance(box, s))));
    const nodeClearance = Math.min(Infinity, ...nodes.filter((node) => node.id !== own.source && node.id !== own.target).map(({ box: node }) => Math.hypot(
      Math.max(node.x - box.x - box.width, box.x - node.x - node.width, 0),
      Math.max(node.y - box.y - box.height, box.y - node.y - node.height, 0))));
    return { edge: own.id, box, distance, other, nodeClearance: Number.isFinite(nodeClearance) ? nodeClearance : null };
  });
  const tabs = [...svg.matchAll(/<g id="container-([^"]+)"([^>]*)>(.*?)<\/g>/g)].map((m) => ({
    id: m[1], lines: [...m[3].matchAll(/<tspan /g)].length,
  }));
  const faces = new Map<string, typeof edges>();
  for (const edge of edges) for (const [id, p, q] of [[edge.source, edge.points[0], edge.points[1]],
    [edge.target, edge.points.at(-1)!, edge.points.at(-2)!]] as const) {
    if (!id) continue;
    const face = near(p.x, q.x) ? q.y > p.y ? "SOUTH" : "NORTH" : q.x > p.x ? "EAST" : "WEST";
    const key = `${id} ${face}`;
    faces.set(key, [...faces.get(key) ?? [], edge]);
  }
  const facePairs = new Map<string, number>();
  for (const face of faces.values()) for (const [i, a] of face.entries()) for (const b of face.slice(i + 1)) {
    const count = a === b ? 0 : countCrossings([a, b]);
    if (count) facePairs.set([a.id, b.id].sort().join(" / "), count);
  }
  const canvas = svg.match(/<svg[^>]* width="([^"]+)" height="([^"]+)"/);
  assert.ok(canvas, "missing visual canvas");
  const metrics = {
    totalBends: edges.reduce((sum, edge) => sum + edge.bends, 0),
    totalEdgeLength: edges.reduce((sum, edge) => sum + edge.length, 0),
    crossings: countCrossings(edges),
    maxLabelDistance: Math.max(0, ...labels.map((label) => label.distance)),
    meanLabelDistance: labels.length ? labels.reduce((sum, label) => sum + label.distance, 0) / labels.length : 0,
    maxDetourRatio: Math.max(1, ...edges.filter((edge) => !edge.detourExempt).map((edge) => edge.detour)),
    maxTabLines: Math.max(0, ...tabs.map((tab) => tab.lines)),
    totalTabLines: tabs.reduce((sum, tab) => sum + tab.lines, 0),
    sameFaceCrossings: [...facePairs.values()].reduce((sum, count) => sum + count, 0),
    labelAffinityViolations: labels.filter((label) => label.other <= label.distance + 0.03).length,
    width: Number(canvas[1]), height: Number(canvas[2]),
  };
  const bendAudit = auditBends(svg, model, edges);
  return { metrics, edges: edges.map(({ id, length, bends, detour, detourExempt }) => ({ id, length, bends, detour, detourExempt, minimumBends: bendAudit.minima.get(id) })), labels, tabs,
    bendViolations: bendAudit.violations, bendExceptions: bendAudit.exceptions,
    sameFacePairs: [...facePairs.keys()] };
}

export type VisualMetrics = ReturnType<typeof visualQuality>["metrics"];
export function assertVisualWidth(quality: ReturnType<typeof visualQuality>) {
  assert.ok(quality.metrics.width <= widthBudget, `chart width ${quality.metrics.width} > ${widthBudget}px`);
}
export function assertLabelAffinity(quality: { labels: { edge: string; distance: number; other: number }[] }) {
  for (const label of quality.labels) assert.ok(label.other > label.distance + 0.03,
    `${label.edge} label is not closest to its own edge (${label.distance} vs ${label.other})`);
}
// Compromised charts can include collapsed sections. Audit ownership without
// requiring the independent route-quality guarantees of visualQuality.
export function assertSvgLabelAffinity(svg: string) {
  const edges = [...svg.matchAll(/<g id="edge-([^"]+)"[^>]*>(.*?)<\/g>/g)].map((match) => ({
    id: match[1], segments: [...match[2].matchAll(/data-points="([^"]+)"/g)].flatMap((section) => {
      const points = section[1].split(" ").map((point) => {
        const [x, y] = point.split(",").map(Number);
        assert.ok(Number.isFinite(x) && Number.isFinite(y), "invalid affinity route");
        return { x, y };
      });
      return points.length === 1 ? [{ a: points[0], b: points[0] }] : points.slice(1).map((b, i) => ({ a: points[i], b }));
    }),
  }));
  const labels = [...svg.matchAll(/id="label-([^"]+)-label" data-pill="([^"]+)"/g)].map((match) => {
    const box = boxOf(match[2]), own = edges.find((edge) => edge.id === match[1]);
    assert.ok(own, `orphan affinity label ${match[1]}`);
    return { edge: own.id, distance: Math.min(...own.segments.map((segment) => labelDistance(box, segment))),
      other: Math.min(...edges.filter((edge) => edge !== own).flatMap((edge) => edge.segments.map((segment) => labelDistance(box, segment)))) };
  });
  assertLabelAffinity({ labels });
}
export function assertVisualLimits(quality: ReturnType<typeof visualQuality>) {
  assert.deepEqual(quality.bendViolations, [], "needless bends");
  for (const edge of quality.edges) assert.ok(edge.detourExempt || edge.detour <= 1.8 + 1e-6, `${edge.id} detour ${edge.detour} > 1.8`);
  for (const label of quality.labels) {
    assert.ok(label.distance <= 8.03, `${label.edge} label distance ${label.distance} > 8px`);
    assert.ok(label.nodeClearance === null || label.nodeClearance >= 16 - 0.03, `${label.edge} label clearance ${label.nodeClearance} < 16px from an unrelated node`);
  }
  assertLabelAffinity(quality);
  for (const tab of quality.tabs) assert.ok(tab.lines <= 2, `${tab.id} tab has ${tab.lines} lines`);
  assert.deepEqual(quality.sameFacePairs, [], "edges on the same face cross");
}

const exactMetrics = new Set<keyof VisualMetrics>(["totalBends", "crossings", "maxDetourRatio", "maxTabLines", "totalTabLines", "sameFaceCrossings", "labelAffinityViolations"]);
export function assertVisualBaseline(actual: VisualMetrics, baseline: VisualMetrics) {
  assert.deepEqual(Object.keys(actual).sort(), Object.keys(baseline).sort(), "visual metric schema changed; inspect and update deliberately");
  for (const key of Object.keys(actual) as (keyof VisualMetrics)[]) {
    assert.ok(Number.isFinite(actual[key]) && Number.isFinite(baseline[key]), `${key} must be finite`);
    assert.ok(actual[key] <= baseline[key] * (exactMetrics.has(key) ? 1 : 1.05) + 1e-6,
      `${key}: ${actual[key]} exceeds baseline ${baseline[key]}${exactMetrics.has(key) ? "" : " + 5%"}`);
  }
}

export function visualCorpus() {
  const fixtures = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? fixtures(path.join(dir, entry.name)) : entry.name === "model.json" ? [path.join(dir, entry.name)] : []);
  const files = ["architecture", "flow", "sequence", "warnings"].map((name) => path.join(root, "examples", name, "model.json"));
  files.push(...fixtures(path.join(import.meta.dirname, "fixtures")));
  return files.map((file) => ({ id: path.relative(root, path.dirname(file)).replaceAll("\\", "/"), file }));
}

export async function measureChart(file: string, out: string) {
  const result = run(file, out, path.join(path.dirname(file), "view.mjs"), ["--svg"]);
  assert.ok(result.status === 0 || result.status === 1, `${path.basename(path.dirname(file))}: ${result.stderr}`);
  const model = loadModel(file), answers = answersOf(model, await loadView(path.join(path.dirname(file), "view.mjs")));
  const quality = visualQuality(fs.readFileSync(path.join(out, "chart.svg"), "utf8"), model, answers);
  if (quality.metrics.width > widthBudget) assert.ok(result.report.includes(`WideChart: The chart is ${quality.metrics.width} px wide;`), "wide output must report its actual width");
  else assert.doesNotMatch(result.report, /WideChart:/);
  return quality;
}
