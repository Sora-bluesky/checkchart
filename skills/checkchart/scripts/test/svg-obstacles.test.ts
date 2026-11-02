import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import ELK from "elkjs/lib/elk.bundled.js";
import { parseModel, loadModel } from "../frontends/model.ts";
import { answersOf, checkView } from "../frontends/view.ts";
import { graphScene } from "../backends/svg/graph.ts";
import { sequenceScene } from "../backends/svg/sequence.ts";
import { render } from "../backends/svg/render.ts";
import { routeTextObstacles, segmentCrossesBox, textObstacles } from "../backends/svg/obstacles.ts";
import { emptyScene } from "../backends/svg/scene.ts";
import { headerHeight, textBlock } from "../backends/svg/text.ts";
import { root, run, scratch } from "./helpers.ts";
import { assertLayoutQuality, layoutQuality } from "./svg-geometry.ts";

const check = { rules: [], bugs: [], unchecked: [] };
const view = checkView({ title: "acme", reader: "A maintainer", question: "How does acme work?",
  label: (id, kind) => kind === "zone" ? "信頼しない入出力の領域" : id, step: () => "Sends a request" });

// The design contract covers entry AND exit, nested regions, all flow directions,
// and sequence groups. Routing may change; measured text and endpoints may not.
for (const direction of ["TB", "TD", "BT", "LR", "RL"]) test(`${direction} zone tabs reserve text-sized space and direction-facing boundary ports`, async () => {
  const model = parseModel({ kind: "architecture", direction, zones: { outer: { untrusted: true }, inner: { parent: "outer" } },
    components: { a: {}, b: { zone: "inner" }, c: {} }, connections: [{ from: "a", to: "b" }, { from: "b", to: "c" }] });
  if (model.kind !== "architecture") return;
  const scene = await graphScene(model, answersOf(model, view), check, new ELK());
  const svg = render(scene, "acme", []);
  const tabs = [...svg.matchAll(/ data-tab="([^"]+)"/g)].map((match) => match[1].split(" ").map(Number));
  assert.equal(tabs.length, 2, "each zone needs a measured tab, rather than a full-width header band");
  for (const [index, zone] of [...scene.containers].sort((a, b) => b.box.width * b.box.height - a.box.width * a.box.height).entries()) {
    assert.ok(zone.box.width >= tabs[index][2] + 48 - 0.02);
    assert.equal(Number(tabs[index][2].toFixed(2)), Number((zone.text.width + (zone.untrusted ? 42 : 24)).toFixed(2)));
    assert.equal(Number(tabs[index][3].toFixed(2)), Number((zone.text.height + 8).toFixed(2)));
  }
  const quality = assertLayoutQuality(svg, model);
  assert.deepEqual(quality.portViolations, []);
  assert.deepEqual(quality.borderViolations, []);
});

test("sequence participant groups use tabs above every message row", () => {
  const model = parseModel({ kind: "sequence", participants: ["a", "b"], messages: [{ from: "a", to: "b", type: "signal" }] });
  if (model.kind !== "sequence") return;
  const answers = answersOf(model, checkView({ ...view, group: () => "acme participant group", colors: { "acme participant group": "teal" } }));
  const scene = sequenceScene(model, answers, check);
  const svg = render(scene, "acme", []);
  assert.match(svg, / data-tab="/);
  assertLayoutQuality(svg, model);
});

for (const kind of ["node", "tab", "own pill", "note", "frame", "canvas"]) test(`orthogonal detours preserve ${kind} text and endpoints`, () => {
  const scene = emptyScene();
  scene.width = 600; scene.height = 300;
  const box = { x: 230, y: 120, width: 140, height: 60 }, text = textBlock("acme");
  const start = { x: 20, y: 150 }, end = { x: 580, y: 150 };
  scene.edges.push({ id: "e0", sections: [[start, end]], dashed: false, head: "filled", labels: [] });
  if (kind === "node") scene.nodes.push({ id: "n0", box, text, shape: "box", classes: [] });
  if (kind === "tab") scene.containers.push({ id: "g0", box: { ...box, y: 140 }, text, headerHeight: headerHeight(text), untrusted: true, sequence: true, classes: [] });
  if (kind === "own pill") scene.edges[0].labels.push({ id: "e0-label", box, text });
  if (kind === "note") scene.notes.push({ id: "note0", box, text });
  if (kind === "frame") scene.frames.push({ id: "par0", box, branches: [{ y: 140, text }] });
  const extra = kind === "canvas" ? [box] : [];
  const originalText = structuredClone({ nodes: scene.nodes, containers: scene.containers, notes: scene.notes, frames: scene.frames, labels: scene.edges[0].labels });
  const obstacles = [...textObstacles(scene), ...extra];
  assert.ok(obstacles.some((obstacle) => segmentCrossesBox(start, end, obstacle)));
  routeTextObstacles(scene, extra);
  const points = scene.edges[0].sections[0];
  assert.deepEqual(points[0], start);
  assert.deepEqual(points.at(-1), end);
  assert.ok(points.length > 2);
  for (let i = 1; i < points.length; i++) {
    assert.ok(points[i].x === points[i - 1].x || points[i].y === points[i - 1].y);
    assert.ok(obstacles.every((obstacle) => !segmentCrossesBox(points[i - 1], points[i], obstacle)));
  }
  assert.deepEqual({ nodes: scene.nodes, containers: scene.containers, notes: scene.notes, frames: scene.frames, labels: scene.edges[0].labels }, originalText);
  routeTextObstacles(scene, extra);
  assert.deepEqual(scene.edges[0].sections[0], points, "final routing is idempotent");
});

test("geometry audit rejects an edge through its own pill and a tangent, unported zone crossing", () => {
  const model = parseModel({ kind: "architecture", zones: { area: {} }, components: { a: {}, b: { zone: "area" } }, connections: [{ from: "a", to: "b" }] });
  const svg = '<g id="container-z0" data-container="100 20 100 100" data-tab="100 20 50 28"><text data-text="112 24 26 20"></text></g>'
    + '<g id="label-e0-label" data-pill="40 10 40 20"></g><g id="edge-e0"><path data-points="0,20 200,20"/></g>';
  const quality = layoutQuality(svg, model);
  assert.ok(quality.textCollisions.some((collision) => collision.includes("label-e0-label")));
  assert.ok(quality.borderViolations.some((collision) => collision.includes("runs along z0")));
  assert.ok(quality.portViolations.some((collision) => collision.includes("without a port")));
});

const modelFiles = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
  entry.isDirectory() ? modelFiles(path.join(dir, entry.name)) : entry.name === "model.json" ? [path.join(dir, entry.name)] : []);
for (const file of [...modelFiles(path.join(root, "examples")), ...modelFiles(path.join(import.meta.dirname, "fixtures"))]) {
  test(`text and port geometry: ${path.relative(root, file).replaceAll("\\", "/")}`, (t) => {
    const result = run(file, path.join(scratch(t), "out"), path.join(path.dirname(file), "view.mjs"), ["--svg"]);
    assert.ok(result.status === 0 || result.status === 1, result.stderr);
    assertLayoutQuality(fs.readFileSync(path.join(result.out, "chart.svg"), "utf8"), loadModel(file));
  });
}

// Optional external corpus is read only; no machine-specific path enters the repository.
if (process.env.CHECKCHART_PARENT_CHARTS) for (const name of ["archA", "archB", "flow", "seq"]) {
  test(`parent chart text and port geometry: ${name}`, () => {
    const dir = path.join(process.env.CHECKCHART_PARENT_CHARTS!, name);
    fs.mkdirSync(path.join(root, ".tmp"), { recursive: true });
    const out = fs.mkdtempSync(path.join(root, ".tmp", `${name}-`));
    const result = run(path.join(dir, "model.json"), path.join(out, "out"), path.join(dir, "view.mjs"), ["--svg"]);
    assert.ok(result.status === 0 || result.status === 1, result.stderr);
    const quality = assertLayoutQuality(fs.readFileSync(path.join(result.out, "chart.svg"), "utf8"), loadModel(path.join(dir, "model.json")));
    fs.writeFileSync(path.join(out, "geometry.json"), JSON.stringify(quality, null, 2) + "\n", "utf8");
  });
}
