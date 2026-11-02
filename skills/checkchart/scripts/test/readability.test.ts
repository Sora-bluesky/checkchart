import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { runModel, simpleArchitecture, simpleFlow, simpleSequence } from "./helpers.ts";

const purpose = 'export const title = "acme request flow"; export const reader = "A maintainer"; export const question = "How does a request finish?";';
const labeled = purpose + 'export const step = () => "Sends a request";';

for (const model of [simpleFlow, simpleSequence, simpleArchitecture]) {
  test(`${model.kind} PurposeStated: missing purpose breaks, complete purpose holds`, (t) => {
    const broken = runModel(t, model);
    assert.equal(broken.status, 1, broken.stderr);
    assert.match(broken.report, /## PurposeStated breaks/);
    assert.match(broken.report, /Missing: title, reader and question/);
    const fixed = runModel(t, model, labeled);
    assert.equal(fixed.status, 0, fixed.stderr || fixed.report);
    assert.match(fixed.report, /^# acme request flow\n\nReader: A maintainer\nQuestion: How does a request finish\?\n/m);
    assert.match(fixed.report.split("## Rules that hold")[1], /PurposeStated/);
    assert.doesNotMatch(fixed.chart, /A maintainer|How does a request finish/);
  });
}

test("PurposeStated lists empty and whitespace-only fields without rejecting the input", (t) => {
  for (const field of ["title", "reader", "question"]) {
    const view = Object.entries({ title: "acme flow", reader: "A maintainer", question: "What happens?", [field]: " \n\t " })
      .map(([key, value]) => `export const ${key} = ${JSON.stringify(value)};`).join("\n");
    const result = runModel(t, simpleFlow, view);
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.report, new RegExp(`Missing: ${field}\\.`));
  }
});

test("reader and question are typed exports and unknown exports still fail", (t) => {
  for (const field of ["reader", "question"]) {
    const result = runModel(t, simpleFlow, `export const ${field} = 7;`);
    assert.equal(result.status, 2);
    assert.match(result.stderr, new RegExp(`${field} must be a string`));
  }
  assert.equal(runModel(t, simpleFlow, purpose + "export const extra = true;").status, 2);
});

test("NoRedundantContainer marks only an architecture outer zone and names its child", (t) => {
  const model = { ...simpleArchitecture, zones: { outer: {}, inner: { parent: "outer" } }, components: { screen: { zone: "inner" }, core: { zone: "inner" } } };
  const broken = runModel(t, model, labeled + 'export const label = { outer: "Process boundary", inner: "Worker area" };', ["--svg"]);
  assert.equal(broken.status, 1, broken.stderr);
  assert.match(broken.report, /## NoRedundantContainer breaks\nProcess boundary:.*Worker area/);
  assert.match(broken.report, /Put the outer zone's meaning into the inner zone's label, or draw the sibling that the outer zone is meant to group\./);
  assert.match(broken.chart, /class z0 breaks/);
  const image = fs.readFileSync(path.join(broken.out, "chart.svg"), "utf8");
  assert.match(image, /id="container-z0" class="container breaks"/);
  const fixed = runModel(t, { ...model, components: { screen: { zone: "outer" }, core: { zone: "inner" } } }, labeled);
  assert.equal(fixed.status, 0, fixed.stderr || fixed.report);
  assert.match(fixed.report.split("## Rules that hold")[1], /NoRedundantContainer/);
  const sibling = runModel(t, { ...model, zones: { ...model.zones, other: { parent: "outer" } } }, labeled);
  assert.equal(sibling.status, 0, sibling.stderr || sibling.report);
  const sequence = runModel(t, simpleSequence, purpose + 'export const colors = { Client: "blue" }; export const group = { screen: "Client" };');
  assert.equal(sequence.status, 0, sequence.stderr);
  assert.doesNotMatch(sequence.report, /NoRedundantContainer/);
});

test("ArrowsLabeled checks each drawn architecture connection and names both ends", (t) => {
  for (const step of ["null", '""', '" \\n "']) {
    const broken = runModel(t, simpleArchitecture, purpose + `export const step = () => ${step};`);
    assert.equal(broken.status, 1, broken.stderr);
    assert.match(broken.report, /## ArrowsLabeled breaks\nThe shortest path has 1 step:\n0\. screen\n1\. core/);
    assert.match(broken.chart, /class n0 breaks/);
    assert.match(broken.chart, /class n1 breaks/);
  }
  const fixed = runModel(t, simpleArchitecture, labeled);
  assert.equal(fixed.status, 0, fixed.stderr || fixed.report);
  assert.match(fixed.report.split("## Rules that hold")[1], /ArrowsLabeled/);
  const omitted = runModel(t, { ...simpleArchitecture, connections: [...simpleArchitecture.connections, { from: "screen", to: "missing" }] }, purpose + 'export const step = (edge) => edge.to === "missing" ? null : "Sends a request";');
  assert.equal(omitted.status, 1, omitted.stderr);
  assert.doesNotMatch(omitted.report, /## ArrowsLabeled breaks/);
});
