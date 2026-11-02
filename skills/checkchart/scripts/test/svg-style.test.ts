import assert from "node:assert/strict";
import test from "node:test";
import ELK from "elkjs/lib/elk.bundled.js";
import { parseModel } from "../frontends/model.ts";
import { answersOf, checkView } from "../frontends/view.ts";
import { graphScene } from "../backends/svg/graph.ts";
import { sequenceScene } from "../backends/svg/sequence.ts";
import { render } from "../backends/svg/render.ts";
import { style } from "../backends/svg/style.ts";
import { emptyScene } from "../backends/svg/scene.ts";
import { edgeLabelBlock, fontSize, textBlock, textWidth } from "../backends/svg/text.ts";

const check = { rules: [], bugs: [], unchecked: [] };
const view = checkView({ title: "acme", label: { a: "acme\nworker", b: "日本語" }, step: (edge: { id?: string }) => edge.id ?? "Request" });

test("native tiles use thin borders, subtle shadows and inset panel headers without a grid", async () => {
  const model = parseModel({ kind: "architecture", zones: { area: { untrusted: true } }, components: { a: { zone: "area" }, b: { zone: "area" } }, connections: [{ from: "a", to: "b", style: "dashed" }] });
  assert.equal(model.kind, "architecture");
  if (model.kind !== "architecture") return;
  const svg = render(await graphScene(model, answersOf(model, view), check, new ELK()), "acme", []);
  assert.match(svg, /<rect class="shape"[^>]* rx="6.00"/);
  assert.match(svg, /<rect class="container-body"[^>]* rx="8.00"/);
  assert.match(style, /\.container-header\s*\{[^}]*fill: none;[^}]*stroke: none;/);
  assert.match(style, /drop-shadow\(/);
  assert.match(style, /\.edge\s*\{[^}]*stroke-width: 1.5px;/);
  assert.match(svg, /class="edge-group dashed"/);
  assert.match(svg, /class="lock"/);
  assert.doesNotMatch(svg, /<pattern|background-image|@font-face|https?:\/\/(?!www.w3.org)/);
  assert.match(svg, /class="mono"[^>]*font-size="13"[^>]*>worker</);
});

for (const kind of ["architecture", "flow"] as const) test(`${kind} dashes come only from the model style`, async () => {
  for (const style of [undefined, "solid", "dashed"] as const) {
    const edge = { from: "a", to: "b", ...(style ? { style } : {}) };
    const model = parseModel(kind === "architecture" ? { kind, components: { a: {}, b: {} }, connections: [edge] }
      : { kind, nodes: { a: { type: "start" }, b: { type: "end" } }, edges: [edge] });
    if (model.kind === "sequence") continue;
    const answers = answersOf(model, checkView({ step: () => "公開鍵 / public build of the docs" }));
    const scene = await graphScene(model, answers, check, new ELK());
    assert.equal(scene.edges[0].dashed, style === "dashed");
  }
});

for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) for (const kind of ["filled", "open"] as const) {
  test(`${kind} heads are 10px long and wide with shafts ending at their bases (${dx}, ${dy})`, () => {
    const scene = emptyScene();
    scene.width = 400; scene.height = 400;
    const start = { x: 200 - dx * 80, y: 200 - dy * 80 }, join = { x: 200, y: 200 };
    const tip = { x: 200 + dx * 40, y: 200 + dy * 40 };
    scene.edges.push({ id: "e0", sections: [[start, join], [join, tip]], head: kind, both: true, dashed: false, labels: [] });
    const original = structuredClone(scene.edges[0].sections);
    const svg = render(scene, "acme", []);
    const group = svg.match(/<g id="edge-e0"[^>]*>(.*?)<\/g>/)![1];
    const points = (value: string) => [...value.matchAll(/(-?\d+\.\d+),(-?\d+\.\d+)/g)].map((m) => ({ x: Number(m[1]), y: Number(m[2]) }));
    const shafts = [...group.matchAll(/class="edge"[^>]* d="([^"]+)"/g)].map((m) => points(m[1]));
    const heads = [...group.matchAll(/class="arrow-(?:filled|open)" (?:points|d)="([^"]+)"/g)].map((m) => points(m[1]));
    assert.equal(heads.length, 2);
    for (const [index, head] of heads.entries()) {
      const end = index ? tip : start, direction = index ? 1 : -1;
      const base = { x: end.x - dx * direction * 10, y: end.y - dy * direction * 10 };
      const corners = head.filter((p) => p.x !== end.x || p.y !== end.y);
      assert.equal(corners.length, 2);
      assert.equal(Math.hypot(corners[0].x - corners[1].x, corners[0].y - corners[1].y), 10);
      assert.deepEqual({ x: (corners[0].x + corners[1].x) / 2, y: (corners[0].y + corners[1].y) / 2 }, base);
      assert.deepEqual(index ? shafts.at(-1)!.at(-1) : shafts[0][0], base);
    }
    assert.deepEqual(shafts[0].at(-1), join, "a boundary without a head keeps its full line");
    assert.deepEqual(shafts[1][0], join);
    assert.deepEqual(scene.edges[0].sections, original, "rendering preserves route endpoints and ports");
  });
}

test("flow main-path arrows are blue while architecture does not infer a main path", async () => {
  const flow = parseModel({ kind: "flow", nodes: { a: { type: "start" }, b: { type: "decision" }, c: {}, d: { type: "end" } }, edges: [{ from: "a", to: "b" }, { from: "b", to: "c", when: "yes" }, { from: "b", to: "d", when: "no" }, { from: "c", to: "d" }] });
  assert.equal(flow.kind, "flow");
  if (flow.kind !== "flow") return;
  const scene = await graphScene(flow, answersOf(flow, view), check, new ELK());
  assert.deepEqual(scene.edges.map((edge) => edge.accent), [true, true, false, true]);
  assert.match(render(scene, "acme", []), /class="edge-group primary"/);
  const architecture = parseModel({ kind: "architecture", components: { a: {}, b: {} }, connections: [{ from: "a", to: "b" }] });
  if (architecture.kind !== "architecture") return;
  assert.doesNotMatch(render(await graphScene(architecture, answersOf(architecture, view), check, new ELK()), "acme", []), /class="edge-group primary"/);
});

test("monospace measurement covers fixed-pitch Latin and fullwidth Japanese punctuation", () => {
  const measure = (value: string) => textWidth(value, 13, 400, "mono");
  assert.equal(measure("iiii"), measure("WWWW"));
  assert.equal(measure("日本"), measure("、。"));
  assert.ok(measure("日本") >= 26);
  assert.equal(measure("e\u0301"), measure("e"));
  const block = textBlock("acme\n日本語 worker", 228, fontSize.node, "first");
  assert.deepEqual(block.sizes, [16, 13]);
  assert.deepEqual(block.families, ["sans", "mono"]);
  assert.ok(block.width >= measure("日本語 worker"));
  const wrapped = textBlock("acme processes every request\nbackground worker", 140, fontSize.node, "first");
  assert.ok(wrapped.lines.length > 2);
  for (const [index, line] of wrapped.lines.entries()) {
    const name = !line.includes("worker") && !line.includes("background");
    assert.equal(wrapped.sizes[index], name ? 16 : 13);
    assert.equal(wrapped.weights[index], name ? 700 : 400);
    assert.equal(wrapped.families[index], name ? "sans" : "mono");
    assert.ok(wrapped.width >= textWidth(line, wrapped.sizes[index], wrapped.weights[index], wrapped.families[index]));
  }
});

test("visible labels fit their routing reservation nearest horizontal and vertical segments", () => {
  for (const caption of ["支払い結果を通知する（Webhook）", "支払い結果を通知する\nWebhook", "支払い結果を通知する、注文サービスが受信して保存する"]) {
    for (const horizontal of [true, false]) for (const side of [-1, 1]) {
      const scene = emptyScene(), block = edgeLabelBlock(caption), width = block.width + 12, height = block.height + 8;
      scene.width = 1000; scene.height = 1000;
      const box = horizontal ? { x: 100, y: 600 + (side < 0 ? -height - 4 : 4), width, height }
        : { x: 600 + (side < 0 ? -width - 4 : 4), y: 100, width, height };
      scene.edges.push({ id: "e0", sections: [horizontal ? [{ x: 40, y: 600 }, { x: 540, y: 600 }]
        : [{ x: 600, y: 40 }, { x: 600, y: 540 }]], head: "filled", dashed: false, labels: [{ id: "e0-label", box, text: block }] });
      const original = structuredClone(box), svg = render(scene, "acme", []);
      const group = svg.match(/<g id="label-e0-label"[^>]*>(.*?)<\/g>/)![0];
      const bounds = (attribute: string) => {
        const [x, y, width, height] = group.match(new RegExp(`${attribute}="([^"]+)"`))![1].split(" ").map(Number);
        return { x, y, width, height };
      };
      const pill = bounds("data-pill"), ink = bounds("data-text");
      assert.equal(ink.height, (block.lines.length - 1) * block.lineHeight + block.fontSize);
      const gap = horizontal ? side < 0 ? 600 - ink.y - ink.height : ink.y - 600 : side < 0 ? 600 - ink.x - ink.width : ink.x - 600;
      assert.equal(gap, horizontal ? 8 : 10, "only the 4px route gap and existing backing padding separate ink from the line");
      assert.ok(pill.x >= box.x && pill.y >= box.y && pill.x + pill.width <= box.x + box.width && pill.y + pill.height <= box.y + box.height,
        "the visible backing stays inside its collision-free reservation");
      assert.deepEqual(box, original, "fitting visible content preserves routing clearance");
    }
  }
});

test("sequence replies keep their dashed lines, open arrowheads and parallel frames", () => {
  const model = parseModel({ kind: "sequence", participants: ["a", "b"], messages: [{ par: [[{ type: "reply", from: "b", to: "a" }], [{ type: "signal", from: "a", to: "b" }]] }] });
  if (model.kind !== "sequence") return;
  const svg = render(sequenceScene(model, answersOf(model, view), check), "acme", []);
  assert.match(svg, /class="edge-group dashed"/);
  assert.match(svg, /class="arrow-open"/);
  assert.match(svg, /class="frame"/);
  assert.match(style, /\.edge-label, \.branch-label\s*\{[^}]*font-family: var\(--font-mono\)/);
});

