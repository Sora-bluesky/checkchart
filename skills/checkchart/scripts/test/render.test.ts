import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { COLORS } from "../ir.ts";
import { esc } from "../backends/mermaid.ts";
import { root, runModelWithPurpose as runModel, simpleArchitecture, simpleFlow, simpleSequence } from "./helpers.ts";

test("flow escaping keeps labels as text, line breaks and non-ASCII letters", (t) => {
  const label = 'Read "x" # < ; [x]\nend 日本語';
  const result = runModel(t, simpleFlow, `export const title = 'acme "forms"'; export const label = () => ${JSON.stringify(label)}; export const step = () => ${JSON.stringify(label)};`);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.chart.startsWith('---\ntitle: "acme \\"forms\\""\n---\nflowchart TB\n'));
  for (const escaped of ["#34;", "#35;", "#60;", "#59;", "#91;x#93;", "<br/>", "#101;nd 日本語"]) assert.ok(result.chart.includes(escaped), escaped);
  assert.doesNotMatch(result.chart, /\r/);
});

test("sequence aliases, message labels and group names use safe text", (t) => {
  const result = runModel(t, simpleSequence, `export const label = () => 'end\\n日本語 "quote" # ; <x>';
export const colors = { 'end #;': 'pink' }; export const group = () => 'end #;';
export const step = () => 'end ; <x>';
`);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.chart, /as #101;nd<br\/>日本語 #34;quote#34; #35; #59; #60;x>/);
  assert.match(result.chart, /box transparent #101;nd #35;#59;/);
  assert.match(result.chart, /p0-\)p1: #101;nd #59; #60;x>/);
});

for (const model of [simpleFlow, simpleSequence, simpleArchitecture]) test(`${model.kind} keeps non-ASCII punctuation beside escaped ASCII hazards`, (t) => {
  const label = '項目・：（）「」—…😀e\u0301 "x" # <x> ; [[x]] end';
  const result = runModel(t, model, `export const label = () => ${JSON.stringify(label)}; export const step = () => ${JSON.stringify(label)};`);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.chart.includes('項目・：（）「」—…😀e\u0301 #34;x#34; #35; #60;x> #59; #91;#91;x#93;#93; #101;nd'), result.chart);
  assert.doesNotMatch(result.chart, /#(?:12539|65306|65288|65289|12300|12301);/);
  if (model.kind !== "sequence") assert.ok(result.chart.includes('n0["項目') || result.chart.includes('n0(["項目'));
});

test("visible Unicode spaces are encoded while control and line separators keep their treatment", () => {
  assert.equal(esc("項目・\u3000\u00a0\u2028\t\u0085\u0090\u200b\ufeff\u0001"), "項目・#12288;#160;   #8203;#65279;#1;");
  assert.equal(esc("\ud800\ud800"), "#65533;#65533;");
});

for (const [model, key, arrow, names] of [
  [simpleFlow, "edges", simpleFlow.edges[0], ["start", "next_2"]],
  [simpleArchitecture, "connections", simpleArchitecture.connections[0], ["screen", "next_2"]],
] as const) test(`${model.kind} passes optional arrow ids to step exactly once`, (t) => {
  const result = runModel(t, { ...model, [key]: [{ ...arrow, id: names[0] }, arrow, { ...arrow, id: names[1] }] }, `
const seen = new WeakSet();
export const step = (edge) => {
  if (seen.has(edge)) throw new Error("step repeated");
  seen.add(edge);
  if (!Object.isFrozen(edge)) throw new Error("mutable arrow");
  return edge.id === undefined ? "Unnamed arrow" : "Named " + edge.id;
};`);
  assert.equal(result.status, 0, result.stderr);
  for (const label of [`Named ${names[0]}`, "Unnamed arrow", `Named ${names[1]}`]) assert.ok(result.chart.includes(`|"${label}"|`), result.chart);
});

test("arrow ids preserve the default labels", (t) => {
  const flow = runModel(t, { ...simpleFlow, edges: [{ ...simpleFlow.edges[0], id: "send", when: "ready" }] });
  assert.equal(flow.status, 0, flow.stderr);
  assert.match(flow.chart, /-->\|"ready"\|/);
  const architecture = runModel(t, { ...simpleArchitecture, connections: [{ ...simpleArchitecture.connections[0], id: "send" }] }, "export const step = () => null;");
  assert.equal(architecture.status, 1, architecture.stderr);
  assert.match(architecture.report, /## ArrowsLabeled breaks/);
  assert.match(architecture.chart, /n0 --> n1/);
});

test("named parallel branches use labels, including nested blocks and repeated ids", (t) => {
  const result = runModel(t, { ...simpleSequence, messages: [{ branches: ["analyze", "show"], par: [
    [{ id: "work", from: "screen", to: "core", type: "signal" }, { branches: ["analyze", "finish"], par: [
      [{ id: "inner", from: "core", to: "screen", type: "signal" }],
      [{ id: "done", from: "core", to: "screen", type: "signal" }],
    ] }],
    [{ from: "core", to: "screen", type: "signal" }],
  ] }] }, `
const seen = new WeakSet();
export const colors = {};
export const group = (id, kind) => { if (kind !== "participant") throw new Error("unexpected group"); };
export const label = (id, kind, fact) => {
  if (kind !== "branch") return id;
  if (seen.has(fact)) throw new Error("label repeated");
  seen.add(fact);
  if (!Object.isFrozen(fact)) throw new Error("mutable branch");
  return id === "analyze" ? "Analyze " + fact[0].id + "・：（）「」;" : id === "show" ? "Show the result" : "Finish";
};`);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.chart, /par Analyze work・：（）「」#59;/);
  assert.match(result.chart, /par Analyze inner・：（）「」#59;/);
  assert.match(result.chart, /and Finish/);
  assert.match(result.chart, /and Show the result/);
  assert.doesNotMatch(result.chart, /Branch [12]/);
});

test("named branches default to their ids and unnamed branches keep their numbering", (t) => {
  const model = { ...simpleSequence, messages: [{ branches: ["analyze", "show"], par: [
    simpleSequence.messages, [{ par: [simpleSequence.messages, simpleSequence.messages] }],
  ] }] };
  const plain = runModel(t, model);
  assert.equal(plain.status, 0, plain.stderr);
  assert.match(plain.chart, /par analyze/);
  assert.match(plain.chart, /and show/);
  assert.match(plain.chart, /par Branch 1/);
  assert.match(plain.chart, /and Branch 2/);
  const mapped = runModel(t, model, 'export const label = { analyze: "Analyze it" };');
  assert.equal(mapped.status, 0, mapped.stderr);
  assert.match(mapped.chart, /par Analyze it/);
  assert.match(mapped.chart, /and show/);
});

test("product checks named branch labels and accepts the product in a branch label", (t) => {
  const model = { ...simpleSequence, messages: [{ par: [simpleSequence.messages, simpleSequence.messages], branches: ["analyze", "show"] }] };
  const broken = runModel(t, model, 'export const product = "acme"; export const title = "acme"; export const label = { analyze: "ACME analyzes" };');
  assert.equal(broken.status, 1, broken.stderr);
  assert.match(broken.report, /branch label: "ACME analyzes"/);
  const fixed = runModel(t, model, 'export const product = "acme"; export const label = { analyze: "acme analyzes" };');
  assert.equal(fixed.status, 0, fixed.stderr || fixed.report);
});

for (const model of [simpleFlow, simpleArchitecture]) test(`${model.kind} legend items have invisible links in every direction`, (t) => {
  for (const direction of ["TB", "TD", "LR", "RL", "BT"]) {
    const result = runModel(t, { ...model, direction }, 'export const colors = { First: "teal", Second: "blue" }; export const group = (id) => ["start", "screen"].includes(id) ? "First" : "Second";');
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.chart, /subgraph legend\["Legend"\]\n    direction LR\n    lg0\["First"\]\n    lg1\["Second"\]\n    lg0 ~~~ lg1\n  end/);
    assert.match(result.report, /and 1 arrows/);
  }
});

test("legend links include rule and path marks, and need at least two items", (t) => {
  const broken = runModel(t, { ...simpleFlow, nodes: { ...simpleFlow.nodes, check: { type: "decision" } }, edges: [
    { from: "start", to: "check" }, { from: "check", to: "done", when: "ready" },
  ] }, 'export const colors = { Team: "teal" }; export const group = () => "Team";');
  assert.equal(broken.status, 1, broken.stderr);
  assert.match(broken.chart, /lg0 ~~~ lg1 ~~~ lg2\n  end/);
  const single = runModel(t, simpleFlow, 'export const colors = { Team: "teal" }; export const group = () => "Team";');
  assert.match(single.chart, /subgraph legend/);
  assert.doesNotMatch(single.chart, /~~~/);
  const empty = runModel(t, simpleFlow);
  assert.doesNotMatch(empty.chart, /subgraph legend|~~~/);
});

test("fill adds all seven light color definitions and the bug path style", (t) => {
  const view = 'export const colors = { Team: "teal" }; export const group = () => "Team";';
  const plain = runModel(t, simpleFlow, view);
  assert.doesNotMatch(plain.chart, /classDef (?:blue|orange|purple|yellow|teal|tan|pink|bugPath)/);
  assert.match(plain.chart, /class n0 teal/);
  const filled = runModel(t, simpleFlow, view, ["--fill"]);
  assert.equal(filled.status, 0);
  for (const [color, hex] of Object.entries(COLORS)) assert.ok(filled.chart.includes(`classDef ${color} fill:${hex}`));
  assert.match(filled.chart, /classDef bugPath stroke:#1680f3,stroke-width:2\.5px/);
});

test("sequence fill colors boxes and never emits a Legend or classDef", (t) => {
  const view = 'export const colors = { Team: "blue" }; export const group = () => "Team";';
  const plain = runModel(t, simpleSequence, view);
  const filled = runModel(t, simpleSequence, view, ["--fill"]);
  assert.match(plain.chart, /box transparent Team/);
  assert.match(filled.chart, /box #c3e0ff Team/);
  assert.doesNotMatch(filled.chart, /Legend|classDef/);
});

test("sequence groups become contiguous in stable order and the report says so", (t) => {
  const model = { ...simpleSequence, participants: ["screen", "core", "other", "last"], messages: [
    ...simpleSequence.messages, { from: "other", to: "last", type: "signal" },
  ] };
  const result = runModel(t, model, 'export const colors = { First: "blue", Second: "teal" }; export const group = { screen: "First", core: "Second", other: "First" };');
  assert.equal(result.status, 0);
  assert.ok(result.chart.indexOf("as screen") < result.chart.indexOf("as other"));
  assert.ok(result.chart.indexOf("as other") < result.chart.indexOf("as core"));
  assert.ok(result.chart.indexOf("as core") < result.chart.indexOf("as last"));
  assert.match(result.report, /reorders participants so that each group is contiguous/);
  assert.match(result.chart, /p0-\)p2/);
});

test("view functions are called once per element, even for chart marks and report paths", (t) => {
  const result = runModel(t, { ...simpleFlow, nodes: { ...simpleFlow.nodes, check: { type: "decision" } }, edges: [{ id: "approach", from: "start", to: "check" }, { id: "leave", from: "check", to: "done", when: "valid" }] }, `
const labels = new Set(); const groups = new Set(); const steps = new WeakSet();
export const colors = { Team: "teal" };
export const label = (id, kind, fact) => { const key = kind + id; if (labels.has(key)) throw new Error("label repeated"); labels.add(key); if (!Object.isFrozen(fact)) throw new Error("mutable fact"); return "Reader " + id; };
export const group = (id, kind) => { const key = kind + id; if (groups.has(key)) throw new Error("group repeated"); groups.add(key); return "Team"; };
export const step = (edge) => { if (steps.has(edge)) throw new Error("step repeated"); steps.add(edge); if (!Object.isFrozen(edge)) throw new Error("mutable edge"); return "Reader " + edge.id; };
`);
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.chart, /Reader approach/);
  assert.match(result.report, /Reader approach: Reader check/);
});

test("architecture zones and components with the same id remain distinct", (t) => {
  const result = runModel(t, { ...simpleArchitecture, zones: { core: {} }, components: { screen: { shape: "person" }, core: { zone: "core", shape: "external" } } }, `export const label = (id, kind) => kind === "zone" ? "Working area" : id;`);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.chart, /subgraph z0\["Working area"\]/);
  assert.match(result.chart, /n1\[\/"core"\/\]/);
  assert.match(result.chart, /n0\(\["screen"\]\)/);
});

test("Mermaid identifies only untrusted zones with dashed borders and a legend", (t) => {
  const model = { ...simpleArchitecture, zones: { input: { untrusted: true }, plain: {} }, components: { screen: { zone: "input" }, core: { zone: "plain" } }, connections: [{ from: "core", to: "screen" }] };
  for (const flags of [[], ["--fill"]]) {
    const result = runModel(t, model, undefined, flags);
    assert.equal(result.status, 0, result.stderr || result.report);
    assert.match(result.chart, /lg0\["Untrusted content"\]/);
    assert.match(result.chart, /class lg0 untrusted/);
    assert.match(result.chart, /class z0 untrusted/);
    assert.doesNotMatch(result.chart, /class z1 untrusted/);
    assert.match(result.chart, /classDef untrusted .*stroke-width:2px,stroke-dasharray:6 4/);
  }
  const plain = runModel(t, { ...model, zones: { input: { untrusted: false }, plain: {} } });
  assert.equal(plain.status, 0, plain.stderr || plain.report);
  assert.doesNotMatch(plain.chart, /untrusted|Untrusted content|subgraph legend/);
});

test("architecture and flow draw solid, dashed and two-way arrows with labels", (t) => {
  const result = runModel(t, { ...simpleArchitecture, connections: [
    { from: "screen", to: "core" }, { from: "screen", to: "core", dir: "both" },
    { from: "screen", to: "core", style: "dashed" }, { from: "screen", to: "core", dir: "both", style: "dashed" },
  ] }, 'export const step = () => "Connects";');
  assert.equal(result.status, 0);
  for (const arrow of ["-->", "<-->", "-.->", "<-.->"]) assert.ok(result.chart.includes(`${arrow}|"Connects"|`));
});

test("null hides an arrow label, not the arrow or the budget warning", (t) => {
  const result = runModel(t, { ...simpleFlow, edges: Array.from({ length: 21 }, () => ({ from: "start", to: "done", when: "valid" })) }, "export const step = () => null;");
  assert.equal(result.status, 0);
  assert.equal([...result.chart.matchAll(/n0 --> n1/g)].length, 21);
  assert.doesNotMatch(result.chart, /\|/);
  assert.match(result.report, /The chart draws 21 arrows, more than the budget of about 20, so it may be hard to read\. Merge steps or split the chart\./);
});

test("sequence notes and legend entries do not count as arrows", (t) => {
  const result = runModel(t, { ...simpleSequence, messages: [...Array.from({ length: 20 }, () => simpleSequence.messages[0]), { type: "note", over: ["screen", "core"] }] });
  assert.equal(result.status, 0);
  assert.match(result.report, /21 messages\. The chart draws 2 participants and 20 arrows/);
  assert.doesNotMatch(result.report, /more than the budget/);
});

test("all chart kinds warn only above twenty actual arrows", (t) => {
  for (const kind of ["sequence", "architecture"]) {
    const model = kind === "sequence" ? { ...simpleSequence, messages: Array.from({ length: 21 }, () => simpleSequence.messages[0]) }
      : { ...simpleArchitecture, connections: Array.from({ length: 21 }, () => simpleArchitecture.connections[0]) };
    const result = runModel(t, model);
    assert.equal(result.status, 0);
    assert.match(result.report, /draws 21 arrows, more than the budget/);
  }
});

test("product checks title, labels, arrow text and used group names in all kinds", (t) => {
  for (const model of [simpleFlow, simpleSequence, simpleArchitecture]) {
    for (const source of [
      'export const product = "acme"; export const title = "ACME"; export const label = () => "acme";',
      'export const product = "acme"; export const title = "acme"; export const step = () => "ACME sends a message";',
      'export const product = "acme"; export const title = "acme"; export const colors = { "ACME team": "teal" }; export const group = () => "ACME team";',
      'export const product = "acme"; export const step = () => "acme";',
    ]) {
      const result = runModel(t, model, source);
      assert.equal(result.status, 1, result.stderr);
      assert.match(result.report, /## ProductName breaks/);
    }
  }
});

test("product is optional and unused group names are not drawn or checked", (t) => {
  const result = runModel(t, simpleFlow, 'export const product = "acme"; export const title = "acme"; export const colors = { "ACME unused": "teal", Team: "teal" }; export const group = () => "Team";');
  assert.equal(result.status, 0);
  assert.doesNotMatch(result.chart, /ACME unused/);
  assert.doesNotMatch(runModel(t, simpleFlow).report, /ProductName/);
});

test("product checks exclude connection labels that cannot be drawn", (t) => {
  const result = runModel(t, { ...simpleArchitecture, connections: [...simpleArchitecture.connections, { from: "screen", to: "missing" }] }, 'export const product = "acme"; export const title = "acme"; export const step = (connection) => connection.to === "missing" ? "ACME" : "Connects";');
  assert.equal(result.status, 1);
  assert.match(result.report, /## EndsDeclared breaks/);
  assert.doesNotMatch(result.report, /## ProductName breaks/);
  assert.doesNotMatch(result.chart, /ACME/);
});

test("public artifacts are valid UTF-8 without BOM or CR line endings", () => {
  const visit = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name.startsWith(".checkchart-") || entry.name === "node_modules") return [];
    const file = path.join(dir, entry.name);
    return entry.isDirectory() ? visit(file) : [file];
  });
  const files = ["skills/checkchart", "examples", ".claude-plugin", ".github"].flatMap((dir) => visit(path.join(root, dir)));
  files.push(path.join(root, "NOTICE"));
  for (const file of files) {
    const bytes = fs.readFileSync(file);
    assert.notDeepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf], file);
    assert.equal(bytes.includes(13), false, file);
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    assert.doesNotMatch(text, /(?<![A-Za-z])[A-Za-z]:[\\/]/, file);
  }
  assert.ok(fs.readFileSync(path.join(root, "skills/checkchart/scripts/checkchart"), "utf8").startsWith("#!/bin/sh\n"));
  assert.ok(fs.readFileSync(path.join(root, "skills/checkchart/SKILL.md"), "utf8").split("\n").length < 180);
});
