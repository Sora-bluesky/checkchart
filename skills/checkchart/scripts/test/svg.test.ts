import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { loadModel } from "../frontends/model.ts";
import { zoneParents } from "../backends/presentation.ts";
import { overlaps, type Box } from "../backends/svg/scene.ts";
import { textWidth } from "../backends/svg/text.ts";
import type { Model } from "../ir.ts";
import { cli, fixture, root, run, runModelWithPurpose as runModel, scratch, simpleArchitecture, simpleFlow, simpleSequence } from "./helpers.ts";
import { assertLayoutQuality } from "./svg-geometry.ts";

const image = (out: string) => fs.readFileSync(path.join(out, "chart.svg"), "utf8");
const boxes = (svg: string, attribute: string): Box[] => [...svg.matchAll(new RegExp(` ${attribute}="([^"]+)"`, "g"))].map((match) => {
  const [x, y, width, height] = match[1].split(" ").map(Number);
  assert.ok([x, y, width, height].every(Number.isFinite));
  return { x, y, width, height };
});

function rectangle(svg: string, cls: string): Box {
  const match = svg.match(new RegExp(`<rect class="${cls}" x="([^"]+)" y="([^"]+)" width="([^"]+)" height="([^"]+)"`));
  assert.ok(match, `missing ${cls} rectangle`);
  const [x, y, width, height] = match.slice(1).map(Number);
  assert.ok([x, y, width, height].every(Number.isFinite));
  return { x, y, width, height };
}

function zoneGeometry(svg: string, model: Model) {
  if (model.kind !== "architecture") return;
  const containers = new Map([...svg.matchAll(/<g id="container-([^"]+)"[^>]*>(.*?)<\/g>/g)].map((match) =>
    [match[1], { box: rectangle(match[2], "container-body"), header: rectangle(match[2], "container-header") }]));
  const nodes = new Map([...svg.matchAll(/<g id="node-([^"]+)"[^>]* data-node="[^"]+"/g)].map((match) =>
    [match[1], boxes(match[0], "data-node")[0]]));
  assert.equal(containers.size, Object.keys(model.zones).length);
  assert.equal(nodes.size, Object.keys(model.components).length);
  const parents = zoneParents(model);
  for (const [index, [componentId, component]] of Object.entries(model.components).entries()) {
    const node = nodes.get(`n${index}`);
    assert.ok(node, `missing component ${componentId}`);
    const ancestors = new Set<string>();
    for (let zone = component.zone; zone !== undefined && Object.hasOwn(model.zones, zone); zone = parents.get(zone)) ancestors.add(zone);
    for (const [index, id] of Object.keys(model.zones).entries()) {
      const container = containers.get(`z${index}`);
      assert.ok(container, `missing zone ${id}`);
      const { box, header } = container;
      if (ancestors.has(id)) {
        const margins = [node.x - box.x, box.x + box.width - node.x - node.width,
          node.y - header.y - header.height, box.y + box.height - node.y - node.height];
        assert.ok(margins.every((margin) => margin >= 8 - 0.02), `component ${componentId} outside ancestor ${id} or its header clearance: ${JSON.stringify({ node, box, header, margins })}`);
      } else assert.equal(overlaps(node, box), false, `nonmember component ${componentId} overlaps zone ${id}: ${JSON.stringify({ node, box })}`);
    }
  }
}

function geometry(svg: string, model?: Model) {
  const nodes = [...boxes(svg, "data-node"), ...boxes(svg, "data-note")];
  const pills = boxes(svg, "data-pill");
  for (const [index, box] of nodes.entries()) for (const other of nodes.slice(index + 1)) assert.equal(overlaps(box, other), false, `overlapping nodes: ${JSON.stringify([box, other])}`);
  for (const pill of pills) for (const node of nodes) assert.equal(overlaps(pill, node), false, `pill on a node: ${JSON.stringify([pill, node])}`);
  const paths = [...svg.matchAll(/ data-points="([^"]+)"/g)];
  for (const path of paths) {
    const points = path[1].split(" ").map((point) => point.split(",").map(Number));
    for (let i = 1; i < points.length; i++) assert.ok(points[i][0] === points[i - 1][0] || points[i][1] === points[i - 1][1], `diagonal segment: ${path[1]}`);
  }
  const nodeBoxes = new Map([...svg.matchAll(/id="node-([^"]+)" class="node ([a-z]+) [^"]*" data-node="([^"]+)"/g)].map((match) => [match[1], { shape: match[2], box: match[3].split(" ").map(Number) }]));
  for (const match of svg.matchAll(/<g id="edge-[^"]+"[^>]* data-source="([^"]+)" data-target="([^"]+)"[^>]*>(.*?)<\/g>/g)) {
    const sections = [...match[3].matchAll(/ data-points="([^"]+)"/g)].map((section) => section[1].split(" ").map((point) => point.split(",").map(Number)));
    for (const [id, point] of [[match[1], sections[0]?.[0]], [match[2], sections.at(-1)?.at(-1)]] as const) {
      assert.ok(point, "edge has no section");
      const node = nodeBoxes.get(id);
      assert.ok(node, "edge has no node");
      const [x, y, w, h] = node.box;
      assert.ok(point[0] >= x - 0.02 && point[0] <= x + w + 0.02 && point[1] >= y - 0.02 && point[1] <= y + h + 0.02, `edge misses ${id}: ${point}`);
      const [px, py] = point, cx = x + w / 2, cy = y + h / 2;
      let outline: boolean;
      if (node.shape === "decision") outline = Math.abs(Math.abs(px - cx) / (w / 2) + Math.abs(py - cy) / (h / 2) - 1) < 0.005;
      else if (node.shape === "terminal") {
        const rx = Math.min(h / 2, w / 2), end = Math.max(x + rx, Math.min(x + w - rx, px));
        outline = Math.abs(((px - end) / rx) ** 2 + ((py - cy) / (h / 2)) ** 2 - 1) < 0.005;
      } else if (node.shape === "store" && (py < y + 8 || py > y + h - 8)) {
        const capY = py < cy ? y + 8 : y + h - 8;
        outline = Math.abs(((px - cx) / (w / 2)) ** 2 + ((py - capY) / 8) ** 2 - 1) < 0.005;
      } else outline = Math.min(Math.abs(px - x), Math.abs(px - x - w), Math.abs(py - y), Math.abs(py - y - h)) < 0.02;
      assert.ok(outline, `edge misses the ${node.shape} outline of ${id}: ${point}`);
    }
  }
  const diagram = boxes(svg, "data-diagram")[0];
  assert.ok(diagram);
  for (const legend of boxes(svg, "data-legend")) assert.equal(overlaps(legend, diagram), false, "legend overlaps diagram");
  // The actual SVG elements and their bounds must fit in the declared diagram.
  for (const box of [...nodes, ...pills, ...boxes(svg, "data-container")]) {
    assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.width <= diagram.width + 0.02 && box.y + box.height <= diagram.height + 0.02, `clipped element: ${JSON.stringify(box)}`);
  }
  if (model) { zoneGeometry(svg, model); assertLayoutQuality(svg, model); }
}

for (const kind of ["flow", "sequence", "architecture", "warnings"]) test(`${kind} SVG matches its golden and has clean geometry`, (t) => {
  const dir = path.join(root, "examples", kind);
  const result = run(path.join(dir, "model.json"), path.join(scratch(t), "out"), path.join(dir, "view.mjs"), ["--svg"]);
  assert.equal(result.status, 0, result.stderr || result.report);
  assert.equal(result.stdout, result.report);
  const svg = image(result.out);
  geometry(svg, loadModel(path.join(dir, "model.json")));
  const wideExamples = JSON.parse(fs.readFileSync(new URL("./visual-quality-baseline.json", import.meta.url), "utf8")).wideExamples ?? {};
  if (wideExamples[`examples/${kind}`]) assert.match(result.report, /WideChart:/);
  else assert.doesNotMatch(result.report, /WideChart:/);
  assert.match(svg, /@media \(prefers-color-scheme: dark\)/);
  assert.match(svg, /--canvas: #1f1f1f/);
  assert.match(svg, /role="img"/);
  assert.match(svg, /<title id="chart-title">acme /);
  assert.doesNotMatch(svg, / style=|\r/);
  for (const name of ["chart.svg", "chart.mmd"]) assert.deepEqual(fs.readFileSync(path.join(result.out, name)), fs.readFileSync(path.join(dir, name)), name);
  const plainReport = fs.readFileSync(path.join(dir, "report.md"), "utf8");
  const withoutMeasured = (report: string) => report.replace(/^- (?:Crossings(?::| between)|WideChart:).*\n/gm, "").replace(/## Warnings\n(?:None\.\n)?(?=\n)/, "## Warnings\n");
  assert.equal(withoutMeasured(result.report), withoutMeasured(plainReport));
});

for (const name of fs.readdirSync(path.join(root, "examples/broken"))) test(`${name} SVG draws the rule failure with clean geometry`, (t) => {
  const result = fixture(t, name, ["--svg"]);
  assert.equal(result.status, 1, result.stderr || result.report);
  const svg = image(result.out);
  geometry(svg, loadModel(path.join(root, "examples/broken", name, "model.json")));
  assert.match(svg, /Breaks /);
  if (name === "architecture-trust-checked") assert.match(svg, /class="edge-group trust-break"/);
  if (name.startsWith("sequence-")) { assert.match(svg, /class="break-band"/); assert.match(svg, /class="note break-note"/); }
});

for (const direction of ["tb", "lr"]) test(`${direction} SVG encloses components below wrapped zone headers at every nesting level`, (t) => {
  const dir = path.join(import.meta.dirname, "fixtures", `architecture-containment-${direction}`);
  const model = loadModel(path.join(dir, "model.json"));
  assert.equal(model.kind, "architecture");
  if (model.kind !== "architecture") return;
  const result = run(path.join(dir, "model.json"), path.join(scratch(t), "out"), path.join(dir, "view.mjs"), ["--svg"]);
  assert.equal(result.status, 0, result.stderr || result.report);
  const svg = image(result.out);
  geometry(svg, model);
  const headerLines = [...svg.matchAll(/<g id="container-[^"]+"[^>]*>(.*?)<\/g>/g)]
    .map((group) => [...group[1].matchAll(/<tspan /g)].length);
  assert.deepEqual(headerLines, direction === "tb" ? [2] : [2, 2, 2]);
  const [first, second] = [0, 1].map((index) => {
    const group = svg.match(new RegExp(`<g id="node-n${index}"[^>]*>`));
    assert.ok(group);
    return boxes(group[0], "data-node")[0];
  });
  if (direction === "tb") assert.ok(second.y >= first.y + first.height);
  else {
    assert.ok(second.x >= first.x + first.width);
    assert.match(result.report, /WideChart: .*Shorten the labels/);
  }
});

test("--svg is optional, and a missing elkjs fails before publishing any output", (t) => {
  const dir = scratch(t);
  // A Node import hook blocks elkjs resolution without moving installed files,
  // changing package state, or giving the production CLI an environment switch.
  const hook = path.join(dir, "no-elk.mjs");
  fs.writeFileSync(hook, `import { registerHooks } from "node:module";
registerHooks({ resolve(specifier, context, next) {
  if (specifier.startsWith("elkjs/")) throw new Error("elkjs intentionally unavailable");
  return next(specifier, context);
} });
`, "utf8");
  for (const [index, model] of [simpleFlow, simpleSequence, simpleArchitecture].entries()) {
    const file = path.join(dir, `model${index}.json`);
    fs.writeFileSync(file, JSON.stringify(model), "utf8");
    const out = path.join(dir, `plain${index}`);
    const args = ["--disable-warning=ExperimentalWarning", "--import", pathToFileURL(hook).href, cli, file, "--out", out];
    const plain = spawnSync(process.execPath, args, { encoding: "utf8" });
    assert.equal(plain.status, 1, plain.stderr); // Missing purpose does not need elkjs.
    assert.equal(fs.existsSync(path.join(out, "chart.svg")), false);
    const missingOut = path.join(dir, `missing${index}`);
    const missing = spawnSync(process.execPath, [...args.slice(0, -1), missingOut, "--svg"], { encoding: "utf8" });
    assert.equal(missing.status, 2, missing.stderr);
    assert.equal(missing.stderr.trim(), "Run npm install in <skill dir>/scripts to draw SVG.");
    assert.equal(missing.stdout, "");
    assert.equal(fs.existsSync(missingOut), false);
  }
});

test("SVG uses one set of view answers, XML escapes text and has deterministic bytes", (t) => {
  const model = { ...simpleFlow, nodes: { ...simpleFlow.nodes, check: { type: "decision" } }, edges: [{ from: "start", to: "check" }, { from: "check", to: "done", when: "valid" }] };
  const view = `const labels = new Set(), groups = new Set(), steps = new WeakSet();
export const title = 'acme <forms> & "data"';
export const colors = { Team: "yellow" };
export const label = (id) => { if (labels.has(id)) throw Error("label repeated"); labels.add(id); return id + " 日本語\\n<x> & data"; };
export const group = (id) => { if (groups.has(id)) throw Error("group repeated"); groups.add(id); return "Team"; };
export const step = (edge) => { if (steps.has(edge)) throw Error("step repeated"); steps.add(edge); return "Send <x> & data"; };
`;
  const first = runModel(t, model, view, ["--svg"]), second = runModel(t, model, view, ["--svg"]);
  assert.equal(first.status, 1, first.stderr);
  assert.equal(second.status, 1, second.stderr);
  const svg = image(first.out);
  assert.equal(svg, image(second.out));
  assert.match(svg, /&lt;forms&gt; &amp; &quot;data&quot;/);
  assert.match(svg, /&lt;x&gt; &amp; data/);
  assert.doesNotMatch(svg, /<x>/);
  geometry(svg);
  assert.match(first.report, /0\. start 日本語 <x> & data\n1\. Send <x> & data: check 日本語 <x> & data/);
});

for (const direction of ["TB", "TD", "BT", "LR", "RL"]) test(`SVG follows ${direction} without using the legend as a layout node`, (t) => {
  const result = runModel(t, { ...simpleFlow, direction }, 'export const colors = { Team: "teal" }; export const group = () => "Team";', ["--svg"]);
  assert.equal(result.status, 0, result.stderr);
  const svg = image(result.out), [first, last] = boxes(svg, "data-node");
  if (direction === "LR") assert.ok(first.x < last.x);
  else if (direction === "RL") assert.ok(first.x > last.x);
  else if (direction === "BT") assert.ok(first.y > last.y);
  else assert.ok(first.y < last.y);
  geometry(svg);
});

test("SVG retains invalid architecture ancestry and skips undeclared connections", (t) => {
  const result = runModel(t, { kind: "architecture", zones: { a: { parent: "b" }, b: { parent: "a" }, c: { parent: "missing" } }, components: { first: { zone: "a" }, second: { zone: "missing" } }, connections: [{ from: "first", to: "second" }, { from: "first", to: "absent" }] }, undefined, ["--svg"]);
  assert.equal(result.status, 1, result.stderr);
  const svg = image(result.out);
  assert.equal(boxes(svg, "data-container").length, 3);
  assert.equal([...svg.matchAll(/id="edge-e/g)].length, 1);
  geometry(svg);
});

test("SVG sequence keeps group order, nested frames, multiline notes and self arrows", (t) => {
  const model = { ...simpleSequence, participants: ["screen", "core", "other"], messages: [{ par: [[{ type: "self", from: "other", to: "other" }], [{ par: [simpleSequence.messages, [{ type: "note", over: ["other"] }]] }]] }] };
  const result = runModel(t, model, 'export const colors = { Team: "pink" }; export const group = { screen: "Team", other: "Team" }; export const step = () => "日本語の長い文章を改行して表示します\\nThe next hard line";', ["--svg"]);
  assert.equal(result.status, 0, result.stderr || result.report);
  const svg = image(result.out);
  assert.equal([...svg.matchAll(/id="frame-par/g)].length, 2);
  assert.match(svg, /class="container group pink"/);
  assert.equal(boxes(svg, "data-node").length, 6);
  geometry(svg);
});

test("SVG keeps shape sizes consistent and grows boxes for indivisible long labels", (t) => {
  const result = runModel(t, { kind: "flow", direction: "LR", nodes: { start: { type: "start" }, short: {}, long: {}, check: { type: "decision" }, other: { type: "decision" }, db: { type: "store" }, copy: { type: "store" }, end: { type: "end" } }, edges: [{ from: "start", to: "short" }, { from: "short", to: "long" }, { from: "long", to: "check" }, { from: "check", to: "other", when: "yes" }, { from: "check", to: "end", when: "no" }, { from: "other", to: "end", when: "yes" }, { from: "other", to: "db", when: "no" }, { from: "db", to: "copy" }] }, `export const label = { long: "日本語の長い文章を改行しながら同じ大きさで表示します", other: "A longer decision label that wraps", copy: "A longer store label\\nwith a hard break", end: "A longer terminal label" };`, ["--svg"]);
  assert.equal(result.status, 0, result.stderr || result.report);
  const svg = image(result.out);
  geometry(svg);
  for (const kind of ["box", "decision", "terminal", "store"]) {
    const sizes = [...svg.matchAll(new RegExp(`class="node ${kind} [^"]*" data-node="([^"]+)"`, "g"))].map((match) => match[1].split(" ").map(Number).slice(2));
    assert.ok(sizes.length >= 2, kind);
    for (const [width, height] of sizes) {
      const limit = kind === "box" ? Math.ceil(textWidth("日本語の長い文章を改行しながら同じ大きさで表示します", 16, 700)) + 32 : 260;
      assert.ok(width >= (kind === "decision" ? 160 : 140) && width <= limit);
      assert.ok(height >= (kind === "decision" ? 90 : 52));
      assert.deepEqual([width, height], sizes[0]);
    }
  }
  assert.doesNotMatch(svg, /textLength=|lengthAdjust=/);
  assert.match(svg, />日本語の長い文章を改行しながら同じ大きさで表示します<\/tspan>/);
});

test("SVG handles deeper zones, sibling zones, empty zones and multiple connections", (t) => {
  const result = runModel(t, { kind: "architecture", direction: "LR", zones: { outer: { untrusted: true }, left: { parent: "outer" }, inner: { parent: "left" }, right: { parent: "outer" }, empty: {} }, components: { a: { zone: "inner" }, b: { zone: "left", shape: "store" }, c: { zone: "right", shape: "external" }, d: { shape: "person" } }, connections: [{ from: "a", to: "b", dir: "both" }, { from: "a", to: "c", style: "dashed" }, { from: "d", to: "a", checkedBy: "a" }, { from: "c", to: "d", checkedBy: "d" }] }, 'export const step = () => "A connection label";', ["--svg"]);
  assert.equal(result.status, 0, result.stderr || result.report);
  geometry(image(result.out));
});

test("SVG keeps untrusted borders and locks, and marks only unchecked incoming data", (t) => {
  const model = { ...simpleArchitecture, zones: { input: { untrusted: true }, plain: {} }, components: { screen: { zone: "input" }, core: { zone: "plain" } } };
  for (const [connection, status] of [
    [{ from: "core", to: "screen" }, 0],
    [{ from: "screen", to: "core" }, 1],
    [{ from: "core", to: "screen", dir: "both", checkedBy: "screen" }, 1],
    [{ from: "core", to: "screen", dir: "both", checkedBy: "core" }, 0],
  ] as const) {
    const result = runModel(t, { ...model, connections: [connection] }, undefined, ["--svg"]);
    assert.equal(result.status, status, result.stderr || result.report);
    const svg = image(result.out);
    geometry(svg);
    const untrusted = svg.match(/<g id="container-z0"[^>]*>(.*?)<\/g>/)?.[0] ?? "";
    const plain = svg.match(/<g id="container-z1"[^>]*>(.*?)<\/g>/)?.[0] ?? "";
    assert.match(untrusted, /class="container untrusted /);
    assert.match(untrusted, /class="lock"/);
    assert.match(plain, /class="container /);
    assert.doesNotMatch(plain, /untrusted|class="lock"/);
    assert.match(svg, /class="swatch untrusted"/);
    assert.match(svg, />Untrusted content<\/tspan>/);
    assert.equal(/class="edge-group trust-break"/.test(svg), status === 1);
  }
});

test("report path labels stay on one line for sequences and architecture too", (t) => {
  for (const model of [
    { ...simpleSequence, messages: [{ from: "screen", to: "core", type: "call" }] },
    { ...simpleArchitecture, zones: { remote: { untrusted: true } }, components: { screen: { zone: "remote" }, core: {} } },
  ]) {
    const result = runModel(t, model, 'export const label = () => "Reader\\nwords"; export const step = () => "Sends\\na request";', ["--svg"]);
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.report, /Reader words/);
    assert.match(result.report, /Sends a request/);
    assert.doesNotMatch(result.report, /Reader\nwords|Sends\na request/);
    assert.match(image(result.out), /<tspan[^>]*>Reader<\/tspan><tspan[^>]*>words<\/tspan>/);
  }
});

test("SVG publication preserves the existing output-folder guard", (t) => {
  const result = runModel(t, simpleFlow, `import fs from "node:fs";
fs.mkdirSync(new URL("./out/", import.meta.url));
fs.writeFileSync(new URL("./out/keep", import.meta.url), "keep\\n", "utf8");`, ["--svg"]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /is not empty/);
  assert.equal(fs.readFileSync(path.join(result.out, "keep"), "utf8"), "keep\n");
  assert.equal(fs.existsSync(path.join(result.out, "chart.svg")), false);
});
