import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { loadModel, parseModel } from "../frontends/model.ts";
import { answersOf, checkView } from "../frontends/view.ts";
import { sequenceScene } from "../backends/svg/sequence.ts";
import { render } from "../backends/svg/render.ts";
import type { Box } from "../backends/svg/scene.ts";
import { run, scratch } from "./helpers.ts";
import { assertLabelAffinity, assertSvgLabelAffinity, assertSvgMinimumJog, assertVisualLimits, visualQuality } from "./visual-quality.ts";
import { assertLineQuality, lineQuality } from "./svg-line-geometry.ts";
import { layoutQuality } from "./svg-geometry.ts";
import { routeGraphLines } from "../backends/svg/line-routing.ts";
import { emptyScene } from "../backends/svg/scene.ts";
import { textBlock } from "../backends/svg/text.ts";
import { routeTextObstacles } from "../backends/svg/obstacles.ts";

// These include deliberately compromised layouts. Keep their explicit geometry
// and warning assertions separate from the strict visual baseline's model.json corpus.
const fixtures = path.join(import.meta.dirname, "fixtures", "rendering");
const cases = ["label-publication", "route-fanout", "flow-retry", "acme-order-tb", "label-affinity",
  "sequence-message", "sequence-self", "sequence-par", "aligned-parallel-bt"];
const boxOf = (data: string): Box => {
  const [x, y, width, height] = data.split(" ").map(Number);
  return { x, y, width, height };
};
const contains = (outer: Box, inner: Box) => inner.x >= outer.x - 0.03 && inner.y >= outer.y - 0.03 &&
  inner.x + inner.width <= outer.x + outer.width + 0.03 && inner.y + inner.height <= outer.y + outer.height + 0.03;

function assertSequenceBounds(svg: string) {
  const diagram = svg.match(/<g id="diagram"[^>]*data-diagram="([^"]+)"/)!;
  const offset = boxOf(diagram[1]), canvas = boxOf(svg.match(/viewBox="([^"]+)"/)![1]);
  const body = svg.slice(diagram.index);
  const texts = [...body.matchAll(/data-text="([^"]+)"/g)].map((m) => boxOf(m[1]));
  for (const text of texts) {
    assert.ok(text.x >= 0, `negative diagram text: ${JSON.stringify(text)}`);
    assert.ok(contains(canvas, { ...text, x: text.x + offset.x, y: text.y + offset.y }), "text exceeds canvas");
  }
  for (const match of svg.matchAll(/<g id="frame-([^"]+)">(.*?)<\/g>/gs)) {
    const rect = match[2].match(/<rect class="frame" x="([^"]+)" y="([^"]+)" width="([^"]+)" height="([^"]+)"/)!;
    const frame = boxOf(rect.slice(1).join(" "));
    for (const text of texts.filter((text) => text.y >= frame.y && text.y + text.height <= frame.y + frame.height)) {
      assert.ok(contains(frame, text), `${match[1]} does not contain ${JSON.stringify(text)}`);
    }
    assert.ok(contains(canvas, { ...frame, x: frame.x + offset.x, y: frame.y + offset.y }));
  }
}

for (const name of cases) test(`valid SVG regression: ${name}`, (t) => {
  const file = path.join(fixtures, `${name}.json`), view = path.join(fixtures, `${name}.mjs`), dir = scratch(t);
  const mermaid = run(file, path.join(dir, "mermaid"), view);
  assert.ok(mermaid.status === 0 || mermaid.status === 1, mermaid.stderr);
  const result = run(file, path.join(dir, "svg"), view, ["--svg"]);
  assert.equal(result.status, mermaid.status, result.stderr);
  assert.deepEqual(fs.readdirSync(result.out).sort(), ["chart.mmd", "chart.svg", "report.md"]);
  assert.equal(result.chart, mermaid.chart);
  const svg = fs.readFileSync(path.join(result.out, "chart.svg"), "utf8"), model = loadModel(file);
  assert.doesNotMatch(svg, /NaN|Infinity/);
  assertSvgLabelAffinity(svg);
  assertSvgMinimumJog(svg);
  if (name === "label-publication" || name === "acme-order-tb") assert.doesNotMatch(result.report, /LayoutCompromise: e\d+ label/);
  if (model.kind === "sequence") {
    assertSequenceBounds(svg);
    if (name === "sequence-message") assert.match(svg, />ProcessThePendingAuthorizationRequestWithoutSpaces<\/tspan>/);
    if (name === "sequence-self") assert.match(svg, />validateAndNormalizeConfiguration<\/tspan>/);
  }
  if (name === "aligned-parallel-bt") {
    const quality = visualQuality(svg, model);
    for (const id of ["e0", "e2", "e3"]) assert.equal(quality.edges.find((edge) => edge.id === id)!.bends, 0, id);
    assertLineQuality(svg, model);
  }
  if (name === "flow-retry") {
    const group = svg.match(/<g id="edge-e2"[^>]*>(.*?)<\/g>/s)!;
    const points = [...group[1].matchAll(/data-points="([^"]+)"/g)].flatMap((m) => m[1].split(" ").map((p) => p.split(",").map(Number)));
    assert.ok(points.length >= 4, "retry has a visible loop");
    const node = boxOf(svg.match(/id="node-n1"[^>]*data-node="([^"]+)"/)![1]);
    assert.ok(points.some(([x, y]) => x < node.x || x > node.x + node.width || y < node.y || y > node.y + node.height));
    assert.match(svg, />retry<\/tspan>/);
    assertVisualLimits(visualQuality(svg, model));
    assertLineQuality(svg, model);
    assert.doesNotMatch(result.report, /LayoutCompromise: e2/);
  }
  const geometry = layoutQuality(svg, model);
  assert.deepEqual(geometry.routeGaps, [], "fallback routes remain joined");
  assert.deepEqual(geometry.containmentViolations, [], "fallback preserves declared containment");
  if (name === "acme-order-tb") {
    assert.doesNotMatch(result.report, /LayoutCompromise:/);
    assert.ok(visualQuality(svg, model).edges.find((edge) => edge.id === "e0")!.bends <= 1, "person to API is straight or one L");
    assertLineQuality(svg, model);
  }
});

test("nested par frames grow to default captions, whole words and child message labels", () => {
  const model = parseModel({ kind: "sequence", participants: ["worker"], messages: [{ branches: ["first", "second"], par: [
    [{ par: [[{ from: "worker", to: "worker", type: "self" }], [{ from: "worker", to: "worker", type: "self" }]] }],
    [{ from: "worker", to: "worker", type: "self" }],
  ] }] });
  assert.equal(model.kind, "sequence");
  if (model.kind !== "sequence") return;
  const answers = answersOf(model, checkView({ title: "acme", reader: "A maintainer", question: "How does acme work?",
    label: { first: "NormalizePendingConfigurationWithoutBreakingWords", second: "Finish local processing" },
    step: () => "ProcessThePendingAuthorizationRequestWithoutSpaces" }));
  const svg = render(sequenceScene(model, answers, { rules: [], bugs: [], unchecked: [] }), "acme", []);
  assertSequenceBounds(svg);
  assertLabelAffinity(visualQuality(svg, model));
  assert.match(svg, />\[NormalizePendingConfigurationWithoutBreakingWords\]<\/tspan>/);
});

for (const direction of ["TB", "BT", "LR", "RL"] as const) test(`${direction} repeated aligned lanes stay straight through a nearby zone tab`, () => {
  const scene = emptyScene(), text = textBlock("acme");
  scene.width = 700; scene.height = 700;
  const transform = (box: Box): Box => {
    const b = direction === "LR" || direction === "RL" ? { x: box.y, y: box.x, width: box.height, height: box.width } : { ...box };
    if (direction === "BT") b.y = 700 - b.y - b.height;
    if (direction === "RL") b.x = 700 - b.x - b.width;
    return b;
  };
  scene.nodes = [100, 450].map((y, i) => ({ id: `n${i}`, box: transform({ x: 100, y, width: 200, height: 80 }), text, shape: "box", classes: [], parent: i ? "area" : "root" }));
  scene.containers = [{ id: "area", box: transform({ x: 60, y: 390, width: 300, height: 200 }), text,
    headerHeight: 29, untrusted: false, classes: [], parent: "root" }];
  scene.edges = Array.from({ length: 3 }, (_, i) => ({ id: `e${i}`, source: i === 2 ? "n1" : "n0", target: i === 2 ? "n0" : "n1",
    sections: [], labels: [], dashed: false, head: "filled" }));
  routeGraphLines(scene, direction);
  const model = { kind: "architecture", direction, zones: { area: { untrusted: false } }, components: { a: {}, b: { zone: "area" } }, connections: [] } as const;
  const quality = visualQuality(render(scene, "acme", []), model);
  for (const edge of quality.edges) assert.equal(edge.bends, 0);
  const axis = direction === "LR" || direction === "RL" ? "y" : "x";
  const lanes = scene.edges.map((edge) => edge.sections[0][0][axis]).sort((a, b) => a - b);
  assert.ok(lanes[1] - lanes[0] >= 24 && lanes[2] - lanes[1] >= 24);
});

test("unavoidable text obstruction draws the edge and reports its missed goal", () => {
  const scene = emptyScene();
  scene.width = 100; scene.height = 100;
  const points = [{ x: 20, y: 50 }, { x: 80, y: 50 }];
  scene.edges.push({ id: "e0", sections: [points], labels: [], dashed: false, head: "filled" });
  scene.notes.push({ id: "blocked", text: textBlock("acme"), box: { x: 0, y: 0, width: 100, height: 100 } });
  routeTextObstacles(scene);
  assert.deepEqual(scene.edges[0].sections[0], points);
  assert.match(render(scene, "acme", []), /id="edge-e0"/);
  assert.ok(scene.warnings.some((warning) => warning.rule === "LayoutCompromise" && /e0.*text/.test(warning.detail)));
});

test("final text-obstacle detours never introduce a short jog", () => {
  const scene = emptyScene();
  scene.width = 220; scene.height = 120;
  scene.edges.push({ id: "e0", sections: [[{ x: 20, y: 50 }, { x: 180, y: 50 }]], labels: [], dashed: false, head: "filled" });
  scene.notes.push({ id: "note", text: textBlock("acme"), box: { x: 90, y: 45, width: 20, height: 10 } });
  assertSvgMinimumJog(render(scene, "acme", []));
});

for (const direction of ["TB", "BT", "LR", "RL"] as const) test(`${direction} near-aligned locked ports retain full jogs after spacing and detour fallbacks`, () => {
  for (const offset of [0, 1, 8, 15.99, 16]) {
    const scene = emptyScene(), text = textBlock("acme");
    scene.width = 700; scene.height = 700;
    const transform = (box: Box): Box => {
      if (direction === "LR" || direction === "RL") box = { x: box.y, y: box.x, width: box.height, height: box.width };
      if (direction === "BT") box.y = 700 - box.y - box.height;
      if (direction === "RL") box.x = 700 - box.x - box.width;
      return box;
    };
    scene.nodes = [0, 1].map((i) => ({ id: `n${i}`, box: transform({ x: 100 + i * offset, y: 100 + i * 110, width: 160, height: 90 }),
      text, shape: "decision", classes: [], parent: "root" }));
    scene.edges.push({ id: "e0", source: "n0", target: "n1", sections: [], labels: [], dashed: false, head: "filled" });
    routeGraphLines(scene, direction, true);
    const svg = render(scene, "acme", []);
    assertSvgMinimumJog(svg);
    assert.ok(scene.edges[0].sections.flat().length >= 2, `${offset}px offset retains a route`);
    if (offset > 0 && offset < 16) assert.ok(scene.width > 700 || scene.height > 700, "spacing is tried before a long detour");
  }
});

test("deterministic small valid architecture, flow and sequence inputs never exit 2", { timeout: 20_000 }, (t) => {
  const dir = scratch(t), view = path.join(dir, "view.mjs");
  fs.writeFileSync(view, 'export const title = "acme processing";\nexport const reader = "A maintainer";\nexport const question = "How does acme work?";\nexport const step = (edge) => edge.when ?? "Sends local data";\n', "utf8");
  let seed = 611;
  const random = (n: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % n; };
  const start = performance.now();
  for (let i = 0; i < 18; i++) {
    const count = 3 + random(2), ids = Array.from({ length: count }, (_, n) => `worker${n}`);
    const direction = ["TB", "BT", "LR", "RL"][i % 4];
    const edges = ids.slice(1).map((to, n) => ({ from: ids[n], to }));
    edges.push({ from: ids[random(count)], to: ids[random(count)] });
    const raw = i === 1 ? { kind: "flow", direction, nodes: { start: { type: "start" }, check: { type: "decision" },
      ...Object.fromEntries(Array.from({ length: 5 }, (_, n) => [`done${n}`, { type: "end" }])) },
      edges: [{ from: "start", to: "check" }, ...Array.from({ length: 5 }, (_, n) => ({ from: "check", to: `done${n}`, when: `case${n}` }))] }
      : i % 3 === 0 ? { kind: "architecture", direction, zones: { area0: {}, area1: {} },
      components: Object.fromEntries(ids.map((id) => [id, random(3) ? { zone: `area${random(2)}` } : {}])), connections: edges }
      : i % 3 === 1 ? { kind: "flow", direction, nodes: Object.fromEntries(ids.map((id, n) => [id, { type: n === 0 ? "start" : n === count - 1 ? "end" : "decision" }])),
        edges: edges.map((edge, n) => ({ ...edge, when: `case${n}` })) }
        : { kind: "sequence", participants: ids, messages: edges.map((edge) => ({ ...edge, type: edge.from === edge.to ? "self" : "signal" })) };
    parseModel(raw);
    const file = path.join(dir, `model-${i}.json`);
    fs.writeFileSync(file, JSON.stringify(raw) + "\n", "utf8");
    const result = run(file, path.join(dir, `out-${i}`), view, ["--svg"]);
    assert.ok(result.status === 0 || result.status === 1, `case ${i}: ${result.stderr}`);
    assert.deepEqual(fs.readdirSync(result.out).sort(), ["chart.mmd", "chart.svg", "report.md"]);
    assert.doesNotThrow(() => assertSvgLabelAffinity(fs.readFileSync(path.join(result.out, "chart.svg"), "utf8")), `case ${i}`);
    assert.doesNotThrow(() => assertSvgMinimumJog(fs.readFileSync(path.join(result.out, "chart.svg"), "utf8")), `case ${i}`);
    if (i === 1) assert.match(result.report, /LayoutCompromise: e\d+ shares a decision vertex/);
  }
  assert.ok(performance.now() - start < 20_000, "generated corpus must finish within 20s");
});
