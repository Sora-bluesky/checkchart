import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import ELK from "elkjs/lib/elk.bundled.js";
import { answersOf, checkView } from "../frontends/view.ts";
import { parseModel } from "../frontends/model.ts";
import { graphScene } from "../backends/svg/graph.ts";
import { sequenceScene } from "../backends/svg/sequence.ts";
import { render } from "../backends/svg/render.ts";
import { textWidth } from "../backends/svg/text.ts";
import { style } from "../backends/svg/style.ts";
import { assertLayoutQuality } from "./svg-geometry.ts";
import { runModel, simpleFlow, simpleSequence } from "./helpers.ts";

const check = { rules: [], bugs: [], unchecked: [] };
const purpose = { title: "acme の構成", reader: "A maintainer", question: "How does acme work?" };
const widthOf = (svg: string) => Number(svg.match(/<svg[^>]* width="([^"]+)"/)?.[1]);

test("node names are bold and subsequent lines stay regular in both graph and sequence SVG", async () => {
  for (const facts of [simpleFlow, simpleSequence]) {
    const model = parseModel(facts);
    const answers = answersOf(model, checkView({ ...purpose, label: () => "acme worker\nHandles requests", step: () => "Sends data" }));
    const scene = model.kind === "sequence" ? sequenceScene(model, answers, check) : await graphScene(model, answers, check, new ELK());
    const svg = render(scene, purpose.title, []);
    for (const node of svg.matchAll(/<g id="node-[^"]+"[^>]*>(.*?)<\/g>/g)) {
      const lines = [...node[1].matchAll(/<tspan [^>]*font-weight="(\d+)"[^>]*>(.*?)<\/tspan>/g)];
      assert.ok(lines.length >= 2);
      assert.equal(lines[0][1], "700");
      assert.ok(lines.slice(1).every((line) => line[1] === "400"));
      assert.doesNotMatch(node[1], /textLength=/, "ordinary names keep their natural glyph sizes");
    }
  }
});

test("all text colors have at least 4.5:1 contrast on every light and dark text surface", () => {
  const luminance = (hex: string) => {
    const rgb = hex.match(/\w\w/g)!.map((pair) => parseInt(pair, 16) / 255)
      .map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
    return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
  };
  const contrast = (a: string, b: string) => {
    const levels = [luminance(a), luminance(b)].sort((a, b) => a - b);
    return (levels[1] + 0.05) / (levels[0] + 0.05);
  };
  for (const [index, sheet] of style.split("@media (prefers-color-scheme: dark)").entries()) {
    const palette = new Map([...sheet.matchAll(/--([\w-]+): #([a-f\d]{6})/g)].map((match) => [match[1], match[2]]));
    for (const [name, color] of palette) if (name.endsWith("-fill") || ["canvas", "zone-header"].includes(name)) {
      assert.ok(contrast(palette.get("text")!, color) >= 4.5, `${index ? "dark" : "light"} text on ${name}`);
      assert.ok(contrast(palette.get("edge-text")!, color) >= 4.5, `${index ? "dark" : "light"} muted text on ${name}`);
    }
    for (const background of ["break-fill", "canvas"]) assert.ok(contrast(palette.get("break-text")!, palette.get(background)!) >= 4.5);
  }
});

test("SVG uses Japanese-capable sans and mono stacks at readable type sizes", async () => {
  const model = parseModel({ kind: "architecture", zones: { area: {} }, components: { a: {}, b: { zone: "area" } }, connections: [{ from: "a", to: "b" }] });
  if (model.kind !== "architecture") return;
  const answers = answersOf(model, checkView({ ...purpose, label: () => "日本語のラベル", step: () => "送信する" }));
  const scene = await graphScene(model, answers, check, new ELK());
  assert.ok(scene.nodes.every((node) => node.text.fontSize === 16));
  assert.ok(scene.containers.every((zone) => zone.text.fontSize === 15));
  assert.ok(scene.edges.flatMap((edge) => edge.labels).every((label) => label.text.fontSize === 13 && label.text.families.every((family) => family === "mono")));
  for (const block of [...scene.nodes, ...scene.containers, ...scene.edges.flatMap((edge) => edge.labels)].map((item) => item.text)) {
    assert.equal(block.lineHeight, Math.max(block.fontSize * 1.4, block.families[0] === "mono" ? 21 : 0));
  }
  const svg = render(scene, purpose.title, [["日本語の凡例", "teal"]]);
  assert.match(svg, /--font-family: "Arial", "BIZ UDPGothic", "Noto Sans JP", "Hiragino Sans", "Yu Gothic UI", "Meiryo", sans-serif;/);
  assert.match(svg, /--font-mono: "BIZ UDGothic", "MS Gothic", monospace;/);
  assert.match(svg, /font-family: var\(--font-family\)/);
  assert.match(svg, /\.mono \{ font-family: var\(--font-mono\);/);
  assert.match(svg, /\.title \{ font-size: 22px; font-weight: 700;/);
  assert.match(svg, /\.header \{ font-size: 15px; font-weight: 700;/);
  assert.match(svg, /\.edge-label, \.branch-label \{ font-family: var\(--font-mono\); font-size: 13px; fill: var\(--edge-text\);/);
  assert.match(svg, /\.legend-label \{ font-size: 14px;/);
  const quality = assertLayoutQuality(svg, model);
  assert.equal(quality.textBoxes, scene.nodes.length + scene.containers.length + scene.edges.flatMap((edge) => edge.labels).length + 2);
  const sequence = parseModel(simpleSequence);
  if (sequence.kind !== "sequence") return;
  const sequenceLayout = sequenceScene(sequence, answersOf(sequence, checkView({ ...purpose, step: () => "送信する" })), check);
  assert.ok(sequenceLayout.nodes.every((node) => node.text.fontSize === 16));
  assert.ok(sequenceLayout.edges.flatMap((edge) => edge.labels).every((label) => label.text.fontSize === 13));
});

for (const label of [
  "日本語の長いラベルを折り返し、読みやすい大きさで安全に表示する（acme のデータ処理）",
  "A long Latin label with wide WWW and MMM letters describes how acme processes a request safely",
]) test(`long label fits its node with padding: ${label}`, async () => {
  const model = parseModel(simpleFlow);
  if (model.kind !== "flow") return;
  const scene = await graphScene(model, answersOf(model, checkView({ ...purpose, label: () => label })), check, new ELK());
  for (const node of scene.nodes) {
    assert.equal(node.text.fontSize, 16);
    assert.ok(node.text.lines.length > 1);
    for (const [index, line] of node.text.lines.entries()) assert.ok(textWidth(line, 16, index ? 400 : 700) <= node.box.width - 32);
    assert.ok(node.text.height <= node.box.height - 24);
  }
});

test("wide architecture zones retain ELK's natural reading direction", async () => {
  const ids = ["a", "b", "c", "d", "e", "f", "g"];
  const model = parseModel({ kind: "architecture", direction: "LR", zones: { area: {} },
    components: Object.fromEntries(ids.map((id) => [id, { zone: "area" }])),
    connections: ids.slice(1).map((to, i) => ({ from: ids[i], to })) });
  if (model.kind !== "architecture") return;
  const scene = await graphScene(model, answersOf(model, checkView({ ...purpose, step: () => "Sends the request" })), check, new ELK());
  const svg = render(scene, purpose.title, []);
  assert.ok(widthOf(svg) > 1100, `width ${widthOf(svg)}`);
  assertLayoutQuality(svg, model);
  assert.ok(scene.nodes.at(-1)!.box.x > scene.nodes[0].box.x);
  assert.equal(scene.nodes.at(-1)!.box.y, scene.nodes[0].box.y);
});

test("WideChart reports final rendered width above 1100px without failing the CLI", (t) => {
  const ids = ["start", "a", "b", "c", "d", "e", "f", "g", "h", "done"];
  const model = { kind: "flow", direction: "LR", nodes: Object.fromEntries(ids.map((id, i) => [id, { type: i === 0 ? "start" : i === ids.length - 1 ? "end" : "step" }])),
    edges: ids.slice(1).map((to, i) => ({ from: ids[i], to })) };
  const result = runModel(t, model, 'export const title = "acme"; export const reader = "A maintainer"; export const question = "How does it finish?";', ["--svg"]);
  assert.equal(result.status, 0, result.stderr || result.report);
  const svg = fs.readFileSync(path.join(result.out, "chart.svg"), "utf8");
  const width = widthOf(svg);
  assert.ok(width > 1100);
  assert.ok(result.report.includes(`WideChart: The chart is ${width} px wide; documents shrink it and the text gets small. Shorten the labels, split the chart, or use direction TB.`), result.report);
});
