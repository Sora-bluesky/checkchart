import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import ELK from "elkjs/lib/elk.bundled.js";
import { loadModel, parseModel } from "../frontends/model.ts";
import { answersOf, checkView, loadView } from "../frontends/view.ts";
import { graphScene } from "../backends/svg/graph.ts";
import { render } from "../backends/svg/render.ts";
import { routeGraphLines } from "../backends/svg/line-routing.ts";
import { emptyScene } from "../backends/svg/scene.ts";
import { textBlock } from "../backends/svg/text.ts";
import { root, run, scratch } from "./helpers.ts";
import { assertLayoutQuality } from "./svg-geometry.ts";
import { assertLineQuality, lineQuality } from "./svg-line-geometry.ts";
import { assertVisualLimits, visualQuality } from "./visual-quality.ts";

const modelFiles = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
  entry.isDirectory() ? modelFiles(path.join(dir, entry.name)) : entry.name === "model.json" ? [path.join(dir, entry.name)] : []);
for (const file of [...modelFiles(path.join(root, "examples")), ...modelFiles(path.join(import.meta.dirname, "fixtures"))]) {
  test(`line rules: ${path.relative(root, file).replaceAll("\\", "/")}`, (t) => {
    const result = run(file, path.join(scratch(t), "out"), path.join(path.dirname(file), "view.mjs"), ["--svg"]);
    assert.ok(result.status === 0 || result.status === 1, result.stderr);
    const svg = fs.readFileSync(path.join(result.out, "chart.svg"), "utf8"), model = loadModel(file);
    assertLineQuality(svg, model);
    assertLayoutQuality(svg, model);
  });
}

for (const direction of ["TB", "TD", "BT", "LR", "RL"]) test(`paired exchange and four-target fanout in ${direction}`, async () => {
  const dir = path.join(import.meta.dirname, "fixtures", "architecture-line-rules");
  const model = parseModel({ ...loadModel(path.join(dir, "model.json")), direction });
  if (model.kind !== "architecture") return;
  const scene = await graphScene(model, answersOf(model, await loadView(path.join(dir, "view.mjs"))), { rules: [], bugs: [], unchecked: [] }, new ELK());
  const svg = render(scene, "acme", []);
  assertLineQuality(svg, model);
  assertLayoutQuality(svg, model);
  assert.equal(scene.edges.filter((edge) => edge.source === "n2").length, 4);
  assert.ok(new Set(scene.nodes.filter((node) => ["n3", "n4", "n5", "n6"].includes(node.id)).map((node) => node.box.width)).size > 1);
});

for (const direction of ["TB", "BT", "LR", "RL"]) for (const count of [2, 3]) test(`${count} parallel connections share a face with another target in ${direction}`, async () => {
  const model = parseModel({ kind: "architecture", direction, components: { a: {}, b: {}, c: {} },
    connections: [...Array.from({ length: count }, (_, i) => i % 2 ? { from: "b", to: "a" } : { from: "a", to: "b" }), { from: "a", to: "c" }] });
  if (model.kind !== "architecture") return;
  const view = checkView({ title: "acme", reader: "A maintainer", question: "How are requests exchanged?", step: () => "Sends data" });
  const scene = await graphScene(model, answersOf(model, view), { rules: [], bugs: [], unchecked: [] }, new ELK());
  const svg = render(scene, "acme", []);
  assertLineQuality(svg, model);
  assertLayoutQuality(svg, model);
  assertVisualLimits(visualQuality(svg, model));
});

test("a straight sibling keeps the shared center while a cross-zone branch uses an L", async () => {
  const dir = path.join(import.meta.dirname, "fixtures", "architecture-shared-face-tb");
  const model = loadModel(path.join(dir, "model.json"));
  if (model.kind !== "architecture") return;
  const scene = await graphScene(model, answersOf(model, await loadView(path.join(dir, "view.mjs"))), { rules: [], bugs: [], unchecked: [] }, new ELK());
  const main = scene.nodes.find((node) => node.id === "n1")!;
  const edges = ["e2", "e3"].map((id) => scene.edges.find((edge) => edge.id === id)!);
  const targets = edges.map((edge) => scene.nodes.find((node) => node.id === edge.target)!);
  assert.equal(main.parent, targets[0].parent);
  assert.notEqual(main.parent, targets[1].parent);
  assert.ok(targets[1].box.y > targets[0].box.y && targets[0].box.y > main.box.y + main.box.height);
  const metrics = visualQuality(render(scene, "acme", []), model).edges;
  assert.equal(metrics.find((edge) => edge.id === edges[0].id)!.bends, 0);
  assert.equal(metrics.find((edge) => edge.id === edges[1].id)!.bends, 1);
  assert.equal(edges[0].sections[0][0].x, main.box.x + main.box.width / 2);
  const svg = render(scene, "acme", []);
  assertLineQuality(svg, model);
  assertLayoutQuality(svg, model);
  assertVisualLimits(visualQuality(svg, model));
});

test("line audit rejects a side escape when a shared preferred face can detour around a sibling", () => {
  const svg = '<g id="container-z0" data-container="0 0 240 320"></g>'
    + '<g id="container-z1" data-container="240 380 220 180"></g>'
    + '<g id="node-n0" data-node="40 40 140 60"></g>'
    + '<g id="node-n1" data-node="40 200 140 60"></g>'
    + '<g id="node-n2" data-node="280 440 140 60"></g>'
    + '<g id="edge-e0" data-source="n0" data-target="n1"><path data-points="110,100 110,200"/></g>'
    + '<g id="edge-e1" data-source="n0" data-target="n2"><path data-points="180,70 220,70 220,400 350,400 350,440"/></g>';
  const model = { kind: "flow", direction: "TB", nodes: {}, edges: [] } as const;
  assert.ok(lineQuality(svg, model).faceViolations.some((message) => message.includes("e1 / n0")));
});

for (const obstacle of ["node", "text"]) test(`line audit exempts only a fully blocked face (${obstacle})`, () => {
  const nodes = '<g id="node-n0" data-node="40 40 140 60"></g><g id="node-n1" data-node="280 440 140 60"></g>';
  const edge = '<g id="edge-e0" data-source="n0" data-target="n1"><path data-points="180,70 220,70 220,400 350,400 350,440"/></g>';
  const wall = (box: string) => obstacle === "node" ? `<g id="node-n2" data-node="${box}"></g>` : `<text data-text="${box}"></text>`;
  const model = { kind: "flow", direction: "TB", nodes: {}, edges: [] } as const;
  const changedFace = (box: string) => lineQuality(nodes + wall(box) + edge, model).faceViolations.filter((message) => message.includes("e0 / n0"));
  assert.deepEqual(changedFace("20 100 180 30"), [], "a solid obstacle covers the entire bottom face");
  assert.ok(changedFace("20 120 180 30").length, "a gap permits a turn before the obstacle");
  assert.ok(changedFace("80 100 40 30").length, "a partial obstruction leaves other ports on the face reachable");
});

for (const obstacle of ["node", "text"]) test(`routing changes a face only when a solid ${obstacle} blocks it`, () => {
  const scene = emptyScene(), text = textBlock("acme");
  scene.width = 500; scene.height = 600;
  scene.nodes = [
    { id: "n0", box: { x: 40, y: 40, width: 140, height: 60 }, text, shape: "box", classes: [] },
    { id: "n1", box: { x: 280, y: 440, width: 140, height: 60 }, text, shape: "box", classes: [] },
  ];
  const box = { x: 20, y: 100, width: 180, height: 30 };
  if (obstacle === "node") scene.nodes.push({ id: "n2", box, text, shape: "box", classes: [] });
  else scene.notes.push({ id: "note", box, text });
  scene.edges = [{ id: "e0", source: "n0", target: "n1", sections: [], dashed: false, head: "filled", labels: [] }];
  routeGraphLines(scene, "TB");
  const [p, q] = scene.edges[0].sections[0];
  assert.equal(p.x, scene.nodes[0].box.x + scene.nodes[0].box.width);
  assert.equal(p.y, q.y);
  assert.ok(q.x > p.x, "the bottom face is fully blocked, so the other target-facing face is legal");
});

test("crowded horizontal labels keep every source and target facing its peer", async () => {
  const ids = ["a", "b", "c", "d", "e", "f"];
  const model = parseModel({ kind: "architecture", direction: "LR", components: Object.fromEntries(ids.map((id) => [id, {}])),
    connections: ids.slice(0, 3).flatMap((from) => ids.slice(3).map((to) => ({ from, to }))) });
  if (model.kind !== "architecture") return;
  const view = checkView({ title: "acme", reader: "A maintainer", question: "Which workers receive data?", step: () => "Sends data" });
  const scene = await graphScene(model, answersOf(model, view), { rules: [], bugs: [], unchecked: [] }, new ELK());
  for (const edge of scene.edges) {
    const points = edge.sections.flat();
    const source = scene.nodes.find((node) => node.id === edge.source)!.box, target = scene.nodes.find((node) => node.id === edge.target)!.box;
    const dx = target.x + target.width / 2 - source.x - source.width / 2, dy = target.y + target.height / 2 - source.y - source.height / 2;
    assert.ok((points[1].x - points[0].x) * dx + (points[1].y - points[0].y) * dy > 0, `${edge.id} source faces its peer`);
    assert.ok((points.at(-1)!.x - points.at(-2)!.x) * dx + (points.at(-1)!.y - points.at(-2)!.y) * dy > 0, `${edge.id} target faces its peer`);
  }
  const svg = render(scene, "acme", []);
  assertLineQuality(svg, model);
  assertLayoutQuality(svg, model);
  assertVisualLimits(visualQuality(svg, model));
});

if (process.env.CHECKCHART_PARENT_CHARTS) for (const name of ["archA", "archB", "flow", "seq"]) {
  test(`parent chart line rules: ${name}`, () => {
    const dir = path.join(process.env.CHECKCHART_PARENT_CHARTS!, name);
    fs.mkdirSync(path.join(root, ".tmp"), { recursive: true });
    const out = fs.mkdtempSync(path.join(root, ".tmp", `${name}-lines-`));
    const result = run(path.join(dir, "model.json"), path.join(out, "out"), path.join(dir, "view.mjs"), ["--svg"]);
    assert.ok(result.status === 0 || result.status === 1, result.stderr);
    const svg = fs.readFileSync(path.join(result.out, "chart.svg"), "utf8"), model = loadModel(path.join(dir, "model.json"));
    const lines = lineQuality(svg, model);
    fs.writeFileSync(path.join(out, "geometry.json"), JSON.stringify({ lines, layout: assertLayoutQuality(svg, model) }, null, 2) + "\n", "utf8");
    assertLineQuality(svg, model);
  });
}

test("line audit rejects off-center side ports, short jogs, close parallel borders and repeat crossings", () => {
  const svg = '<g id="node-n0" data-node="40 0 120 60"></g><g id="node-n1" data-node="40 200 120 60"></g>'
    + '<g id="container-z0" data-container="20 100 200 200"></g>'
    + '<g id="edge-e0" data-source="n0" data-target="n1"><path data-points="160,30 168,30 168,90 28,90 28,180 240,180 240,230 160,230"/></g>';
  const result = lineQuality(svg, { kind: "flow", direction: "TB", nodes: {}, edges: [] });
  for (const key of ["faceViolations", "portViolations", "clearanceViolations", "jogViolations", "crossingViolations"] as const) assert.ok(result[key].length, key);
});

test("line audit proves the pair boundary and rejects crowding, bends and labels between lanes", () => {
  const nodes = '<g id="node-n0" data-node="0 0 140 60"></g><g id="node-n1" data-node="0 200 140 60"></g>';
  const route = (id: string, source: string, target: string, points: string) => `<g id="edge-${id}" data-source="${source}" data-target="${target}"><path data-points="${points}"/></g>`;
  const svg = nodes + route("e0", "n0", "n1", "58,60 58,200") + route("e1", "n1", "n0", "82,200 82,60");
  const model = { kind: "flow", direction: "TB", nodes: {}, edges: [] } as const;
  assert.equal(assertLineQuality(svg, model).minPairSpacing, 24);
  assert.ok(lineQuality(svg.replaceAll("58,", "64,").replaceAll("82,", "76,"), model).pairViolations.length);
  assert.ok(lineQuality(svg.replace("58,60 58,200", "58,60 58,100 42,100 42,160 58,160 58,200"), model).pairViolations.length);
  assert.ok(lineQuality(svg + '<g id="label-e0-label" data-pill="60 110 20 20"></g>', model).pairViolations.length);
  assert.ok(lineQuality(svg.replaceAll("58,", "60,").replaceAll("82,", "84,"), model).portViolations.length);
  assert.ok(lineQuality(svg + '<path d="M 0,0 L 0,8 Q 0,10 2,10"/>', model).radiusViolations.length);
});
