import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { loadModel } from "../frontends/model.ts";
import { checkView } from "../frontends/view.ts";
import { textBlock, textWidth } from "../backends/svg/text.ts";
import { assertLayoutQuality } from "./svg-geometry.ts";
import { assertVisualLimits, visualQuality } from "./visual-quality.ts";
import { root, run, runModel as runRawModel, runModelWithPurpose as runModel, scratch, simpleFlow, simpleSequence } from "./helpers.ts";

const englishCaptions = /Legend|Untrusted content|Breaks |Branch \d|Path to the .* bug|[Uu]ndeclared participant/;
for (const backend of ["mermaid", "svg"]) test(`${backend} renders Japanese fixed captions in architecture and sequence charts`, (t) => {
  for (const kind of ["architecture", "sequence"]) {
    const dir = path.join(root, "examples", "ja", kind);
    const flags = backend === "svg" ? ["--svg"] : [];
    const result = run(path.join(dir, "model.json"), path.join(scratch(t), "out"), path.join(dir, "view.mjs"), flags);
    assert.equal(result.status, 1, result.stderr || result.report);
    const chart = backend === "svg" ? fs.readFileSync(path.join(result.out, "chart.svg"), "utf8") : result.chart;
    assert.match(chart, kind === "architecture" ? /凡例/ : /分岐 1/);
    assert.match(chart, kind === "architecture" ? /信頼しない範囲/ : /分岐 2/);
    assert.match(chart, kind === "architecture" ? /規則違反：TrustChecked/ : /規則違反：Answered/);
    assert.doesNotMatch(chart, englishCaptions);
    if (backend === "svg" && kind === "sequence") assert.match(chart, />並列<\/tspan>/);
    const model = loadModel(path.join(dir, "model.json"));
    const view = fs.readFileSync(path.join(dir, "view.mjs"), "utf8").replace('locale = "ja"', 'locale = "en"');
    const english = runRawModel(t, JSON.parse(fs.readFileSync(path.join(dir, "model.json"), "utf8")), view, flags);
    assert.equal(english.status, 1, english.stderr);
    assert.equal(result.report, english.report, "locale does not translate the report or rule names");
    if (backend === "svg") {
      assertLayoutQuality(chart, model);
      const quality = visualQuality(chart, model);
      assertVisualLimits(quality);
      const baseline = visualQuality(fs.readFileSync(path.join(english.out, "chart.svg"), "utf8"), model);
      for (const key of ["totalBends", "crossings", "maxDetourRatio"] as const) assert.ok(quality.metrics[key] <= baseline.metrics[key], key);
    }
  }
});

test("unknown and non-string locales exit 2, name supported values and publish no files", (t) => {
  for (const value of ['"fr"', '"JA"', '""', "undefined", "null", "42", "{}", "true"]) {
    const result = runModel(t, simpleFlow, `export const locale = ${value};`);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /locale.*"en".*"ja"/);
    assert.equal(fs.existsSync(result.out), false);
  }
});

test("absent locale is English and explicit English preserves chart and report bytes", (t) => {
  assert.equal(checkView({}).locale, "en");
  const plain = runModel(t, simpleSequence);
  const explicit = runModel(t, simpleSequence, 'export const locale = "en";');
  assert.equal(explicit.status, plain.status);
  assert.equal(explicit.chart, plain.chart);
  assert.equal(explicit.report, plain.report);
});

test("Japanese flow paths, standalone breaks and undeclared participants use localized captions", (t) => {
  const flow = runModel(t, { ...simpleFlow, edges: [] }, 'export const locale = "ja";', ["--svg"]);
  const sequence = runModel(t, { kind: "sequence", participants: ["client", "unused"], messages: [{ from: "client", to: "missing", type: "signal" }] }, 'export const locale = "ja";', ["--svg"]);
  for (const result of [flow, sequence]) {
    assert.equal(result.status, 1, result.stderr);
    for (const chart of [result.chart, fs.readFileSync(path.join(result.out, "chart.svg"), "utf8")]) {
      assert.match(chart, /規則違反：/);
      assert.doesNotMatch(chart, englishCaptions);
      assert.match(chart, result === flow ? /違反箇所への経路：/ : /未宣言の参加者/);
    }
  }
});

test("Japanese captions reserve full measured widths and wrap at punctuation without splitting rule names", () => {
  for (const [caption, size, budget] of [["凡例", 14, 260], ["信頼しない範囲", 14, 260], ["規則違反：Answered or Recovered", 16, 228], ["分岐 1", 13, 240]] as const) {
    const block = textBlock(caption, budget, size);
    assert.equal(block.lines.join("").replaceAll(" ", ""), caption.replaceAll(" ", ""));
    assert.ok(block.lines.every((line) => textWidth(line, size) <= block.width));
    assert.ok(block.lines.every((line) => textWidth(line, size) <= budget));
    if (caption.includes("Answered")) {
      assert.ok(block.lines.length > 1);
      assert.ok(block.lines.some((line) => line.includes("Answered")));
    }
  }
});
