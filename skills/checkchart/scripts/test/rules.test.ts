import assert from "node:assert/strict";
import test from "node:test";
import { parseModel } from "../frontends/model.ts";
import { checkArchitecture } from "../passes/architecture.ts";
import { fixture, runModelWithPurpose as runModel, simpleArchitecture, simpleFlow, simpleSequence } from "./helpers.ts";

const cases = [
  { folder: "flow-purpose-stated", rules: ["PurposeStated"], fixed: simpleFlow },
  { folder: "architecture-no-redundant-container", rules: ["NoRedundantContainer"], fixed: simpleArchitecture },
  { folder: "architecture-arrows-labeled", rules: ["ArrowsLabeled"], fixed: simpleArchitecture },
  { folder: "flow-has-start-and-end", rules: ["HasStartAndEnd"], fixed: simpleFlow },
  { folder: "flow-reachable", rules: ["Reachable"], fixed: {
    ...simpleFlow, nodes: { ...simpleFlow.nodes, alone: {} },
    edges: [...simpleFlow.edges, { from: "start", to: "alone" }, { from: "alone", to: "done" }],
  } },
  // HasExit implies ReachesEnd: a non-end with no way forward cannot finish.
  { folder: "flow-has-exit", rules: ["HasExit", "ReachesEnd"], fixed: {
    ...simpleFlow, nodes: { ...simpleFlow.nodes, save: {}, db: { type: "store" } },
    edges: [...simpleFlow.edges, { from: "start", to: "save" }, { from: "save", to: "db" }, { from: "save", to: "done" }],
  } },
  { folder: "flow-reaches-end", rules: ["ReachesEnd"], fixed: {
    ...simpleFlow, nodes: { ...simpleFlow.nodes, first: {}, second: {} },
    edges: [...simpleFlow.edges, { from: "start", to: "first" }, { from: "first", to: "second" }, { from: "second", to: "first" }, { from: "second", to: "done" }],
  } },
  { folder: "flow-decision-branches", rules: ["DecisionBranches"], fixed: {
    ...simpleFlow, nodes: { ...simpleFlow.nodes, check: { type: "decision" } },
    edges: [{ from: "start", to: "check" }, { from: "check", to: "done", when: "valid" }, { from: "check", to: "done", when: "invalid" }],
  } },
  { folder: "flow-end-is-final", rules: ["EndIsFinal"], fixed: simpleFlow },
  { folder: "sequence-declared", rules: ["Declared"], fixed: {
    ...simpleSequence, participants: [...simpleSequence.participants, "unused"],
    messages: [...simpleSequence.messages, { from: "core", to: "unused", type: "signal" }],
  } },
  { folder: "sequence-answered", rules: ["Answered"], fixed: {
    ...simpleSequence, messages: [{ id: "request", from: "screen", to: "core", type: "call" }, { from: "core", to: "screen", type: "reply", answers: "request" }],
  } },
  { folder: "sequence-reply-matches", rules: ["ReplyMatches"], fixed: {
    ...simpleSequence, messages: [{ id: "request", from: "screen", to: "core", type: "call" }, { from: "core", to: "screen", type: "reply", answers: "request" }],
  } },
  { folder: "sequence-recovered", rules: ["Recovered"], fixed: {
    ...simpleSequence, messages: [{ id: "gone", from: "screen", to: "core", type: "lost", recovery: "again" }, { id: "again", from: "core", to: "screen", type: "signal" }],
  } },
  { folder: "sequence-self-is-self", rules: ["SelfIsSelf"], fixed: simpleSequence },
  { folder: "architecture-ends-declared", rules: ["EndsDeclared"], fixed: { ...simpleArchitecture, zones: { area: {} } } },
  { folder: "architecture-trust-checked", rules: ["TrustChecked"], fixed: {
    ...simpleArchitecture, zones: { local: { untrusted: true }, remote: {} },
    components: { screen: { zone: "local" }, core: { zone: "remote" } },
    connections: [{ from: "screen", to: "core", checkedBy: "core" }],
  } },
  { folder: "architecture-connected", rules: ["Connected"], fixed: {
    ...simpleArchitecture, components: { ...simpleArchitecture.components, unused: {} },
    connections: [...simpleArchitecture.connections, { from: "core", to: "unused" }],
  } },
  ...[
    { kind: "flow", fixed: simpleFlow },
    { kind: "sequence", fixed: simpleSequence },
    { kind: "architecture", fixed: simpleArchitecture },
  ].map(({ kind, fixed }) => ({ folder: `${kind}-product-name`, rules: ["ProductName"], fixed })),
];

for (const entry of cases) test(`${entry.folder}: broken CLI exit 1, fixed CLI exit 0`, (t) => {
  const broken = fixture(t, entry.folder);
  assert.equal(broken.status, 1, broken.stderr);
  assert.equal(broken.stdout, broken.report);
  const rules = [...new Set([...broken.report.matchAll(/^## (\w+) breaks$/gm)].map((match) => match[1]))];
  assert.deepEqual(rules.sort(), [...entry.rules].sort());
  for (const rule of entry.rules) assert.ok(broken.report.includes(`## ${rule} breaks`));
  assert.match(broken.chart, entry.folder.startsWith("sequence-") ? /rect rgb\(255, 236, 238\)/ : /class (?:lg|n|z)\d+ breaks/);
  const fixed = runModel(t, entry.fixed, entry.rules.includes("ProductName") ? 'export const product = "acme"; export const title = "acme works";' : undefined);
  assert.equal(fixed.status, 0, fixed.stderr || fixed.report);
  assert.doesNotMatch(fixed.report, /^## \w+ breaks$/m);
});

test("flow uses the shortest path from any start and marks the whole path", (t) => {
  const result = runModel(t, {
    kind: "flow", nodes: { far: { type: "start" }, near: { type: "start" }, via: {}, check: { type: "decision" }, done: { type: "end" } },
    edges: [{ from: "far", to: "via" }, { from: "via", to: "check" }, { from: "near", to: "check" }, { from: "check", to: "done", when: "valid" }],
  }, 'export const label = { near: "Near start", check: "Check the form" };');
  assert.equal(result.status, 1);
  assert.match(result.report, /shortest path has 1 step:\n0\. Near start\n1\. Check the form/);
  assert.match(result.chart, /class n1 bugPath/);
  assert.match(result.chart, /class n3 breaks\n  class n3 bugPath/);
});

test("unreachable nodes and endless cycles have explicit explanations", (t) => {
  assert.match(fixture(t, "flow-reachable").report, /No path from a start reaches A step no start reaches\./);
  const report = fixture(t, "flow-reaches-end").report;
  assert.match(report, /From here no path reaches an end\./);
  assert.match(report, /The run loops through "Try again" and "Wait for a result" forever\./);
});

test("stores do not count as exits or as routes to an end, and ends may write to stores", (t) => {
  const result = runModel(t, {
    kind: "flow", nodes: { start: { type: "start" }, db: { type: "store" }, done: { type: "end" } },
    edges: [{ from: "start", to: "db" }, { from: "db", to: "done" }, { from: "done", to: "db" }],
  });
  assert.equal(result.status, 1);
  assert.match(result.report, /## HasExit breaks/);
  assert.match(result.report, /## ReachesEnd breaks/);
  assert.doesNotMatch(result.report, /## EndIsFinal breaks/);
});

test("flow reports at most five offenders per rule, shortest first", (t) => {
  const nodes = Object.fromEntries(Array.from({ length: 7 }, (_, index) => [`alone${index}`, {}]));
  const result = runModel(t, { ...simpleFlow, nodes: { ...simpleFlow.nodes, ...nodes }, edges: [...simpleFlow.edges, ...Object.keys(nodes).map((from) => ({ from, to: "done" }))] });
  assert.equal(result.status, 1);
  assert.equal([...result.report.matchAll(/## Reachable breaks/g)].length, 5);
  assert.match(result.report, /and 2 more/);
  assert.equal([...result.chart.matchAll(/class n\d+ breaks/g)].length, 7);
});

test("a nested parallel sequence uses depth-first document order", (t) => {
  const result = runModel(t, { ...simpleSequence, messages: [{ par: [
    [{ id: "request", from: "screen", to: "core", type: "call" }],
    [{ par: [[{ from: "core", to: "screen", type: "reply", answers: "request" }], [{ from: "core", to: "core", type: "self" }]] }],
  ] }] });
  assert.equal(result.status, 0, result.stderr || result.report);
  assert.equal([...result.chart.matchAll(/\bpar Branch 1/g)].length, 2);
});

test("sequence checks early, duplicate and reversed replies without hiding facts", (t) => {
  for (const messages of [
    [{ from: "core", to: "screen", type: "reply", answers: "request" }, { id: "request", from: "screen", to: "core", type: "call", timeout: true }],
    [{ id: "request", from: "screen", to: "core", type: "call" }, { from: "core", to: "screen", type: "reply", answers: "request" }, { from: "core", to: "screen", type: "reply", answers: "request" }],
    [{ id: "request", from: "screen", to: "core", type: "call" }, { from: "screen", to: "core", type: "reply", answers: "request" }],
  ]) {
    const result = runModel(t, { ...simpleSequence, messages });
    assert.equal(result.status, 1);
    assert.match(result.report, /## ReplyMatches breaks/);
  }
});

test("sequence rejects missing, same-message and earlier recoveries as rule failures", (t) => {
  for (const messages of [
    [{ from: "screen", to: "core", type: "lost" }],
    [{ id: "gone", from: "screen", to: "core", type: "lost", recovery: "gone" }],
    [{ id: "again", from: "core", to: "screen", type: "signal" }, { from: "screen", to: "core", type: "lost", recovery: "again" }],
  ]) assert.match(runModel(t, { ...simpleSequence, messages }).report, /## Recovered breaks/);
});

test("sequence bug paths leave out other participants' messages once", (t) => {
  const result = runModel(t, { kind: "sequence", participants: ["a", "b", "c", "d"], messages: [
    { from: "c", to: "d", type: "signal", id: "before" },
    { from: "a", to: "b", type: "signal", id: "first" },
    { from: "c", to: "d", type: "signal", id: "other" },
    { from: "c", to: "d", type: "signal", id: "another" },
    { from: "a", to: "b", type: "signal", id: "second" },
    { from: "c", to: "d", type: "signal", id: "lastOther" },
    { from: "a", to: "b", type: "signal", id: "third" },
    { from: "a", to: "b", type: "call", id: "request" },
  ] });
  assert.equal(result.status, 1);
  assert.match(result.report, /The path to it has 4 messages, numbered in the order of the chart:\n1\. a to b: first\n4\. a to b: second\n6\. a to b: third\n7\. a to b: request/);
  assert.doesNotMatch(result.report, /shortest path/);
  assert.equal(result.report.split("(other messages left out)").length - 1, 1);
  assert.doesNotMatch(result.report, /c to d/);
});

test("sequence offenders are sorted by the path the report actually lists", (t) => {
  const result = runModel(t, { kind: "sequence", participants: ["a", "b", "c", "d"], messages: [
    { from: "a", to: "b", type: "signal" }, { from: "a", to: "b", type: "signal" },
    { from: "a", to: "b", type: "call", id: "long" },
    { from: "c", to: "d", type: "call", id: "short" },
  ] });
  assert.equal(result.status, 1);
  const first = result.report.split("## Answered breaks")[1];
  assert.match(first, /c to d: short/);
  assert.doesNotMatch(first, /a to b: long/);
});

test("TrustChecked covers every direction, checker and combination of untrusted ancestry", () => {
  const zones = {
    plain: {}, trusted: { untrusted: false }, input: { untrusted: true }, peer: { untrusted: true },
    nested: { parent: "input", untrusted: false }, deep: { parent: "nested", untrusted: true },
  };
  const locations = [
    { name: "outside", fact: {}, state: "trusted" },
    { name: "plain group", fact: { zone: "plain" }, state: "trusted" },
    { name: "explicit false", fact: { zone: "trusted" }, state: "trusted" },
    { name: "untrusted zone", fact: { zone: "input" }, state: "untrusted" },
    { name: "another untrusted zone", fact: { zone: "peer" }, state: "untrusted" },
    { name: "inherited through false", fact: { zone: "nested" }, state: "untrusted" },
    { name: "multiple untrusted ancestors", fact: { zone: "deep" }, state: "untrusted" },
  ];
  const required: Record<string, "a" | "b" | undefined> = {
    "trusted:trusted:one": undefined, "trusted:trusted:both": undefined,
    "trusted:untrusted:one": undefined, "trusted:untrusted:both": "a",
    "untrusted:trusted:one": "b", "untrusted:trusted:both": "b",
    "untrusted:untrusted:one": undefined, "untrusted:untrusted:both": undefined,
  };
  for (const from of locations) for (const to of locations) for (const dir of ["one", "both"]) {
    const checker = required[`${from.state}:${to.state}:${dir}`];
    for (const checkedBy of [undefined, "a", "b", "other"]) {
      const model = parseModel({ kind: "architecture", zones, components: { a: from.fact, b: to.fact }, connections: [{ from: "a", to: "b", dir, ...(checkedBy === undefined ? {} : { checkedBy }) }] });
      assert.equal(model.kind, "architecture");
      if (model.kind !== "architecture") throw new Error("Expected architecture");
      const check = checkArchitecture(model);
      const expected = checker !== undefined && checkedBy !== checker ? ["TrustChecked"] : [];
      assert.deepEqual(check.bugs.map((bug) => bug.rule), expected, `${from.name} to ${to.name}, dir=${dir}, checkedBy=${checkedBy}`);
      assert.deepEqual(check.unchecked, []);
    }
  }
});

test("architecture checks input from nested untrusted content and reports the receiving direction", (t) => {
  const model = {
    kind: "architecture", zones: { outer: { untrusted: true }, inner: { parent: "outer", untrusted: true }, plain: { parent: "outer" } },
    components: { a: { zone: "inner" }, b: {} },
    connections: [{ from: "a", to: "b", checkedBy: "a" }],
  };
  const view = 'export const label = { a: "Agent output", b: "Parser", inner: "Output pane", outer: "Workspace" }; export const step = () => "Sends a result";';
  const broken = runModel(t, model, view);
  assert.equal(broken.status, 1);
  const inputPath = "0. Agent output (untrusted, inside Output pane and Workspace)\n1. Sends a result: Parser (trusted)\nNothing checks what Parser receives from untrusted content.";
  assert.ok(broken.report.includes(inputPath), broken.report);
  assert.match(broken.chart, /class n0 breaks/);
  assert.match(broken.chart, /class n1 breaks/);
  for (const connection of [{ from: "a", to: "b" }, { from: "b", to: "a", dir: "both" }, { from: "b", to: "a", dir: "both", checkedBy: "a" }]) {
    const result = runModel(t, { ...model, connections: [connection] }, view);
    assert.equal(result.status, 1, result.stderr || result.report);
    assert.ok(result.report.includes(inputPath), result.report);
  }
  for (const connection of [
    { from: "b", to: "a" }, { from: "a", to: "b", checkedBy: "b" },
    { from: "a", to: "b", dir: "both", checkedBy: "b" }, { from: "b", to: "a", dir: "both", checkedBy: "b" },
  ]) {
    const result = runModel(t, { ...model, connections: [connection] }, view);
    assert.equal(result.status, 0, result.stderr || result.report);
    assert.doesNotMatch(result.report, /## TrustChecked breaks/);
  }
});

test("architecture handles missing ends, missing zones and parent cycles as rule failures", (t) => {
  const models = [
    { ...simpleArchitecture, connections: [{ from: "screen", to: "missing" }, { from: "screen", to: "core" }] },
    { ...simpleArchitecture, components: { screen: { zone: "missing" }, core: {} } },
    { ...simpleArchitecture, zones: { first: { parent: "second" }, second: { parent: "first" } }, components: { screen: { zone: "first" }, core: {} } },
  ];
  for (const model of models) {
    const result = runModel(t, model);
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.report, /## EndsDeclared breaks/);
    assert.match(result.report, /Checks not made[\s\S]*TrustChecked/);
    assert.doesNotMatch(result.report.split("## Rules that hold")[1].split("## Checks not made")[0], /TrustChecked/);
    assert.doesNotMatch(result.chart, /undefined/);
  }
});

test("plain groups stay trusted, and checkedBy is allowed when no check is needed", (t) => {
  const model = { ...simpleArchitecture, zones: { root: {}, child: { parent: "root" } }, components: { screen: { zone: "child" }, core: { zone: "root" } } };
  assert.equal(runModel(t, model).status, 0);
  assert.equal(runModel(t, { ...model, connections: [{ from: "screen", to: "core", checkedBy: "screen" }] }).status, 0);
});
