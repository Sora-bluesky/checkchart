import assert from "node:assert/strict";
import test from "node:test";
import ELK from "elkjs/lib/elk.bundled.js";
import { parseModel } from "../frontends/model.ts";
import { answersOf, checkView } from "../frontends/view.ts";
import { checkFlow } from "../passes/flow.ts";
import { checkSequence } from "../passes/sequence.ts";
import { checkArchitecture } from "../passes/architecture.ts";
import { checkProduct } from "../passes/product.ts";
import { mermaid } from "../backends/mermaid.ts";
import { report } from "../backends/report.ts";
import { graphPresentation } from "../backends/presentation.ts";
import { graphScene } from "../backends/svg/graph.ts";
import { sequenceScene } from "../backends/svg/sequence.ts";
import { render, xml } from "../backends/svg/render.ts";
import { style } from "../backends/svg/style.ts";
import { textWidth, wrapText } from "../backends/svg/text.ts";
import { simpleArchitecture, simpleFlow, simpleSequence } from "./helpers.ts";

function prepared(raw: unknown, view: Record<string, unknown> = {}) {
  const model = parseModel(raw);
  const answers = answersOf(model, checkView(view));
  const check = model.kind === "flow" ? checkFlow(model) : model.kind === "sequence" ? checkSequence(model) : checkArchitecture(model);
  if (answers.product !== undefined) {
    check.rules = [...check.rules, "ProductName"];
    check.bugs.push(...checkProduct(model, answers));
  }
  return { model, answers, check };
}

const literalCases = [
  ["fa:fa-user", "fa#58;fa-user"],
  ["fab:fa-x", "fab#58;fa-x"],
  ["[text](https://example.invalid)", "#91;text#93;(https#58;//example.invalid)"],
  ["**bold**", "#42;#42;bold#42;#42;"],
  ["`code`", "#96;code#96;"],
  ["A\u3000B", "A#12288;B"],
  ["A\u00a0B", "A#160;B"],
];
const architecture = { ...simpleArchitecture, zones: { area: {} }, components: { screen: { zone: "area" }, core: { zone: "area" } } };

for (const raw of [simpleFlow, architecture, simpleSequence]) test(`${raw.kind} keeps literal labels in every drawn text position`, async () => {
  for (const [label, encoded] of literalCases) {
    const { model, answers, check } = prepared(raw, { label: () => label, step: () => label, group: () => label, colors: { [label]: "teal" } });
    const chart = mermaid(model, answers, check);
    const occurrences = chart.split(encoded).length - 1;
    assert.ok(occurrences >= (model.kind === "architecture" ? 5 : 4), chart);
    const scene = model.kind === "sequence" ? sequenceScene(model, answers, check) : await graphScene(model, answers, check, new ELK());
    const image = render(scene, "acme", model.kind === "sequence" ? [] : graphPresentation(model, answers, check).legend);
    assert.ok(image.includes(`>${xml(label)}</tspan>`), image);
    for (const node of scene.nodes) assert.equal(node.text.lines.join(""), label);
    for (const edge of scene.edges) for (const pill of edge.labels) assert.equal(pill.text.lines.join(""), label);
    for (const container of scene.containers) assert.equal(container.text.lines.join(""), label);
  }
});

test("product boundaries ignore ASCII substrings and accept CJK neighbors in all text positions", () => {
  for (const raw of [simpleFlow, simpleSequence, simpleArchitecture]) {
    for (const value of ["xacme", "acmeX", "1ACME", "ACME2", "xACMEy", "preACME post"]) {
      const { model, answers } = prepared(raw, { product: "acme", title: "acme", label: () => value, step: () => value, group: () => value, colors: { [value]: "teal" } });
      assert.deepEqual(checkProduct(model, answers), [], value);
    }
    for (const value of ["ACME", "(ACME)", "ACMEの通知", "通知ACME", "acme ACME", "KACMEſ"]) {
      const { model, answers } = prepared(raw, { product: "acme", title: "acme", label: () => value });
      assert.ok(checkProduct(model, answers).length > 0, value);
    }
    const { model, answers } = prepared(raw, { product: "acme", label: () => "xacmeY" });
    assert.ok(checkProduct(model, answers).some((bug) => bug.evidence.kind === "product" && bug.evidence.element.startsWith("The product name is missing")));
  }
  const special = prepared(simpleFlow, { product: "acme+", label: () => "acme+の通知" });
  assert.deepEqual(checkProduct(special.model, special.answers), []);
});

test("flow ProductName violations share shortest paths, unreachable evidence and diagram marks", async () => {
  const { model, answers, check } = prepared({ kind: "flow", nodes: { far: { type: "start" }, via: {}, near: { type: "start" }, bad: {}, done: { type: "end" }, alone: {} }, edges: [
    { from: "far", to: "via" }, { from: "via", to: "bad" }, { from: "near", to: "bad" }, { from: "bad", to: "done" }, { from: "alone", to: "done" },
  ] }, { product: "acme", title: "acme", label: { near: "Begin\nhere", bad: "ACME finishes", alone: "ACME alone" } });
  assert.equal(model.kind, "flow");
  if (model.kind !== "flow") return;
  const bugs = check.bugs.filter((bug) => bug.rule === "ProductName");
  assert.deepEqual(bugs.map((bug) => bug.evidence.kind), ["flow", "flow"]);
  const text = report(model, answers, { ...check, bugs }, "acme");
  assert.match(text, /shortest path has 1 step:\n0\. Begin here\n1\. ACME finishes/);
  assert.match(text, /No path from a start reaches ACME alone\./);
  const chart = mermaid(model, answers, { ...check, bugs });
  assert.match(chart, /Path to the ProductName bug/);
  assert.match(chart, /class n2 bugPath/);
  assert.match(chart, /class n3 breaks\n  class n3 bugPath/);
  assert.doesNotMatch(chart, /class n0 bugPath|class n1 bugPath|class n5 bugPath/);
  const scene = await graphScene(model, answers, { ...check, bugs }, new ELK());
  assert.ok(scene.nodes.find((node) => node.id === "n2")?.classes.includes("bugPath"));
  assert.ok(scene.nodes.find((node) => node.id === "n3")?.classes.includes("breaks"));
  const start = prepared(simpleFlow, { product: "acme", title: "acme", label: { start: "ACME begins" } });
  assert.match(report(start.model, start.answers, start.check, "acme"), /shortest path has 0 steps:\n0\. ACME begins/);
});

test("architecture and sequence ProductName violations keep naming their elements", () => {
  for (const raw of [simpleArchitecture, simpleSequence]) {
    const { model, answers, check } = prepared(raw, { product: "acme", title: "acme", label: { screen: "ACME screen" } });
    assert.match(report(model, answers, check, "acme"), /(?:component|participant) label: "ACME screen"/);
  }
});

test("wrapping uses only spaces and the allowed punctuation", () => {
  assert.deepEqual(wrapText("abc123XYZ", 10, 10), ["abc123XYZ"]);
  assert.deepEqual(wrapText("採番・復旧用tailへ保持", 260 - 12, 12), ["採番・復旧用tailへ保持"]);
  for (const punctuation of ["：", "・", "、", "。", "，", "）"]) {
    assert.deepEqual(wrapText(`abc${punctuation}def`, textWidth(`abc${punctuation}`, 10), 10), [`abc${punctuation}`, "def"]);
  }
  // Indivisible mixed runs keep their natural width.
  assert.deepEqual(wrapText("日本語", 20, 10), ["日本語"]);
  assert.deepEqual(wrapText("ABC123日本", 40, 10), ["ABC123日本"]);
  assert.deepEqual(wrapText("abc」def", 30, 10), ["abc」def"]);
  assert.deepEqual(wrapText("A\u3000B", 200), ["A\u3000B"]);
});

test("zone headers fit multiline text, wrap to their inner width and reserve child space", async () => {
  const { model, answers, check } = prepared({ kind: "architecture", zones: { outer: { untrusted: true }, inner: { parent: "outer" }, empty: {} }, components: { screen: { zone: "inner" }, core: { zone: "inner" } }, connections: simpleArchitecture.connections }, {
    label: { outer: "入力を確認する\n外部からの要求を受け入れない", inner: "通知を検証してから処理を開始する領域です。".repeat(4), empty: "abc123XYZ".repeat(8) },
  });
  assert.equal(model.kind, "architecture");
  if (model.kind !== "architecture") return;
  const scene = await graphScene(model, answers, check, new ELK());
  for (const zone of scene.containers) {
    const inset = zone.untrusted ? 42 : 24;
    assert.equal(zone.headerHeight, zone.text.height + 8);
    assert.ok(zone.text.width + inset + 48 <= zone.box.width + 0.01);
    assert.ok(zone.headerHeight < zone.box.height);
    for (const node of scene.nodes) {
      if (node.box.x >= zone.box.x && node.box.x + node.box.width <= zone.box.x + zone.box.width && node.box.y >= zone.box.y && node.box.y + node.box.height <= zone.box.y + zone.box.height) {
        assert.ok(node.box.y >= zone.box.y + zone.headerHeight + 24 - 0.01);
      }
    }
  }
  const image = render(scene, "acme", []);
  for (const zone of scene.containers) {
    const group = image.match(new RegExp(`<g id="container-${zone.id}"[^>]*>(.*?)</g>`))?.[1];
    assert.ok(group);
    assert.ok(group.includes(`height="${zone.headerHeight.toFixed(2)}"`));
  }
});

test("decision text uses the available width before wrapping and stays inside its diamond", async () => {
  const label = "通知IDと実行IDが有効か";
  const { model, answers, check } = prepared({ ...simpleFlow, nodes: { ...simpleFlow.nodes, check: { type: "decision" } }, edges: [{ from: "start", to: "check" }, { from: "check", to: "done", when: "yes" }, { from: "check", to: "done", when: "no" }] }, { label: { check: label } });
  if (model.kind !== "flow") return;
  const scene = await graphScene(model, answers, check, new ELK());
  const node = scene.nodes.find((node) => node.shape === "decision");
  assert.ok(node);
  assert.deepEqual(node.text.lines, [label]);
  assert.ok(node.box.width <= 260);
  assert.ok(node.text.width / node.box.width + node.text.height / node.box.height < 1);
});

test("sequence labels wrap at the width cap and self labels stay within 260px", () => {
  const label = "採番・復旧用tailへ保持";
  const spanning = "A message across the first and last participants";
  assert.ok(textWidth(spanning, 15) > 240);
  const { model, answers, check } = prepared({ kind: "sequence", participants: ["a", "b", "c"], messages: [{ from: "a", to: "c", type: "signal", id: "wide" }, { from: "b", to: "b", type: "self", id: "self" }] }, {
    step: (message: { id: string }) => message.id === "wide" ? spanning : label,
  });
  if (model.kind !== "sequence") return;
  const scene = sequenceScene(model, answers, check);
  const text = scene.edges[0].labels[0].text;
  assert.equal(text.fontSize, 13);
  assert.ok(text.lines.length > 1);
  assert.equal(text.lines.join(" "), spanning);
  assert.ok(text.lines.every((line) => textWidth(line, 13, 400, "mono") <= 240));
  assert.deepEqual(scene.edges[1].labels[0].text.lines, [label]);
  assert.ok(scene.edges[1].labels[0].box.width <= 260);
});

test("sequence groups have light bodies, inset headers and enough room for the group name", () => {
  const group = "通知を検証する領域\n復旧処理のための情報を保持する";
  const { model, answers, check } = prepared(simpleSequence, { colors: { [group]: "teal" }, group: () => group });
  if (model.kind !== "sequence") return;
  const scene = sequenceScene(model, answers, check), container = scene.containers[0];
  assert.equal(container.headerHeight, container.text.height + 8);
  assert.ok(container.text.width + 24 + 48 <= container.box.width + 0.01);
  assert.ok(scene.nodes[0].box.y >= container.headerHeight + 12);
  assert.match(style, /\.group \.container-body \{[^}]*fill-opacity: 0\.12;[^}]*stroke-opacity: 0\.6;[^}]*stroke-width: 1\.5px;/);
  assert.match(style, /\.container-header \{ fill: none; stroke: none;/);
});

test("nested parallel frames contain their text; break bands span only the involved lifelines", () => {
  const { model, answers, check } = prepared({ kind: "sequence", participants: ["a", "b", "c", "d"], messages: [
    { from: "a", to: "d", type: "signal" },
    { par: [[{ id: "unanswered", from: "b", to: "c", type: "call" }], [{ par: [[{ type: "note", over: ["b", "c"] }], [{ from: "c", to: "c", type: "self" }]] }]] },
  ] });
  if (model.kind !== "sequence") return;
  const scene = sequenceScene(model, answers, check);
  const left = scene.lifelines[1].x - 24, right = scene.lifelines[2].x + 24;
  assert.equal(scene.frames.length, 2);
  assert.equal(scene.bands.length, 1);
  for (const box of scene.bands) {
    assert.equal(box.x, left);
    assert.equal(box.x + box.width, right);
    assert.ok(box.x > 0 && box.x + box.width < scene.width);
  }
  for (const frame of scene.frames) {
    const box = frame.box;
    assert.ok(box.x <= left && box.x + box.width >= right, "frame retains its involved lifelines");
    assert.ok(box.x > 0 && box.x + box.width < scene.width);
    for (const branch of frame.branches) assert.ok(branch.text.width + 24 <= box.width);
    for (const item of [...scene.edges.flatMap((edge) => edge.labels), ...scene.notes, ...scene.frames.filter((child) => child !== frame)]) {
      if (item.box.y < box.y || item.box.y + item.box.height > box.y + box.height) continue;
      assert.ok(item.box.x >= box.x && item.box.x + item.box.width <= box.x + box.width, "frame contains its row content");
    }
  }
  const unused = prepared({ kind: "sequence", participants: ["a", "b", "c"], messages: [{ from: "a", to: "b", type: "signal" }] });
  if (unused.model.kind !== "sequence") return;
  const alone = sequenceScene(unused.model, unused.answers, unused.check);
  assert.equal(alone.bands[0].x, alone.lifelines[2].x - 24);
  assert.equal(alone.bands[0].width, 48);
});
