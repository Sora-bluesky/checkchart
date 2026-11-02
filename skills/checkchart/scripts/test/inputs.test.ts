import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { cli, run, runModelWithPurpose as runModel, scratch, simpleArchitecture, simpleFlow, simpleSequence } from "./helpers.ts";

const invalidModels: [string, unknown, RegExp][] = [
  ["unknown root key", { ...simpleFlow, words: "ignored" }, /Unknown key "words" at \$\["words"\]/],
  ["unknown node key", { ...simpleFlow, nodes: { start: { type: "start", label: "words" }, done: { type: "end" } } }, /\$\["nodes"\]\["start"\]\["label"\]/],
  ["unknown edge key", { ...simpleFlow, edges: [{ from: "start", to: "done", label: "words" }] }, /\$\["edges"\]\[0\]\["label"\]/],
  ["bad node id", { ...simpleFlow, nodes: { "bad-id": {} } }, /id matching/],
  ["unknown edge endpoint", { ...simpleFlow, edges: [{ from: "start", to: "missing" }] }, /\$\["edges"\]\[0\]\["to"\] names unknown node "missing"/],
  ["unknown nested message key", { ...simpleSequence, messages: [{ par: [[{ from: "screen", to: "core", type: "signal", label: "words" }], []] }] }, /\$\["messages"\]\[0\]\["par"\]\[0\]\[0\]\["label"\]/],
  ["unknown parallel key", { ...simpleSequence, messages: [{ par: [[], []], label: "words" }] }, /Unknown key "label"/],
  ["bad parallel arity", { ...simpleSequence, messages: [{ par: [[]] }] }, /at least two branches/],
  ["unknown zone key", { ...simpleArchitecture, zones: { area: { label: "words" } } }, /\$\["zones"\]\["area"\]\["label"\]/],
  ["unknown component key", { ...simpleArchitecture, components: { core: { label: "words" } } }, /\$\["components"\]\["core"\]\["label"\]/],
  ["unknown connection key", { ...simpleArchitecture, connections: [{ from: "screen", to: "core", label: "words" }] }, /\$\["connections"\]\[0\]\["label"\]/],
  ["bad direction", { ...simpleFlow, direction: "down" }, /direction.*TB.*TD.*LR.*RL.*BT/],
  ["bad node type", { ...simpleFlow, nodes: { start: { type: "unknown" } } }, /type.*start.*step/],
  ["bad edge style", { ...simpleFlow, edges: [{ from: "start", to: "done", style: "dots" }] }, /style.*solid.*dashed/],
  ["bad edge id", { ...simpleFlow, edges: [{ id: "bad-id", from: "start", to: "done" }] }, /\$\["edges"\]\[0\]\["id"\].*id matching/],
  ["null edge id", { ...simpleFlow, edges: [{ id: null, from: "start", to: "done" }] }, /\$\["edges"\]\[0\]\["id"\].*id matching/],
  ["non-id condition", { ...simpleFlow, edges: [{ from: "start", to: "done", when: "reader words" }] }, /when.*id matching/],
  ["duplicate participants", { ...simpleSequence, participants: ["screen", "screen"] }, /duplicate id/],
  ["duplicate message ids", { ...simpleSequence, messages: [{ id: "again", from: "screen", to: "core", type: "signal" }, { id: "again", from: "core", to: "screen", type: "signal" }] }, /repeats message id/],
  ["bad timeout", { ...simpleSequence, messages: [{ from: "screen", to: "core", type: "call", timeout: "yes" }] }, /timeout.*true or false/],
  ["bad note", { ...simpleSequence, messages: [{ type: "note", over: [] }] }, /one or two participant ids/],
  ["non-array branch ids", { ...simpleSequence, messages: [{ par: [[], []], branches: "analyze" }] }, /\$\["messages"\]\[0\]\["branches"\].*an array/],
  ["too few branch ids", { ...simpleSequence, messages: [{ par: [[], []], branches: ["analyze"] }] }, /\$\["messages"\]\[0\]\["branches"\].*2 ids/],
  ["too many branch ids", { ...simpleSequence, messages: [{ par: [[], []], branches: ["analyze", "show", "extra"] }] }, /\$\["messages"\]\[0\]\["branches"\].*2 ids/],
  ["bad branch id", { ...simpleSequence, messages: [{ par: [[], []], branches: ["analyze", "bad-id"] }] }, /\$\["messages"\]\[0\]\["branches"\]\[1\].*id matching/],
  ["null branch id", { ...simpleSequence, messages: [{ par: [[], []], branches: ["analyze", null] }] }, /\$\["messages"\]\[0\]\["branches"\]\[1\].*id matching/],
  ["nested branch count", { ...simpleSequence, messages: [{ par: [[{ par: [[], []], branches: [] }], []] }] }, /\$\["messages"\]\[0\]\["par"\]\[0\]\[0\]\["branches"\].*2 ids/],
  ["legacy trust key", { ...simpleArchitecture, zones: { local: { trust: true } } }, /Unknown key "trust" at \$\["zones"\]\["local"\]\["trust"\]/],
  ["legacy trust key with untrusted", { ...simpleArchitecture, zones: { local: { untrusted: true, trust: false } } }, /Unknown key "trust"/],
  ["bad untrusted", { ...simpleArchitecture, zones: { local: { untrusted: "yes" } } }, /untrusted.*true or false/],
  ["null untrusted", { ...simpleArchitecture, zones: { local: { untrusted: null } } }, /untrusted.*true or false/],
  ["null zones", { ...simpleArchitecture, zones: null }, /zones.*an object/],
  ["bad component shape", { ...simpleArchitecture, components: { core: { shape: "circle" } } }, /shape.*box.*store.*person.*external/],
  ["bad connection id", { ...simpleArchitecture, connections: [{ id: "bad-id", from: "screen", to: "core" }] }, /\$\["connections"\]\[0\]\["id"\].*id matching/],
  ["null connection id", { ...simpleArchitecture, connections: [{ id: null, from: "screen", to: "core" }] }, /\$\["connections"\]\[0\]\["id"\].*id matching/],
];

for (const [name, model, error] of invalidModels) test(`input error: ${name}`, (t) => {
  const result = runModel(t, model);
  assert.equal(result.status, 2, result.stderr);
  assert.match(result.stderr, error);
  assert.equal(result.stdout, "");
  assert.equal(fs.existsSync(result.out), false);
});

for (const [kind, model, key, arrow] of [
  ["flow", simpleFlow, "edges", simpleFlow.edges[0]],
  ["architecture", simpleArchitecture, "connections", simpleArchitecture.connections[0]],
] as const) test(`${kind} duplicate arrow ids name both input locations`, (t) => {
  const result = runModel(t, { ...model, [key]: [{ ...arrow, id: "shared" }, arrow, { ...arrow, id: "shared" }] });
  assert.equal(result.status, 2, result.stderr);
  assert.ok(result.stderr.includes('"shared"'), result.stderr);
  for (const index of [0, 2]) assert.ok(result.stderr.includes(`$["${key}"][${index}]["id"]`), result.stderr);
  assert.equal(result.stdout, "");
  assert.equal(fs.existsSync(result.out), false);
});

const invalidViews: [string, string, RegExp, unknown?][] = [
  ["unknown export", 'export const extra = "unused";', /exports extra, which the command does not read\. Export only title, reader, question, product, colors, label, group and step/],
  ["bad color", 'export const colors = { Team: "red" };', /colors give "Team" the color "red".*blue.*pink/],
  ["group without colors", 'export const group = () => "Team";', /group but no colors/],
  ["unknown returned group", 'export const colors = { Team: "teal" }; export const group = () => "Other";', /"Other", which colors does not name/],
  ["unknown map group", 'export const colors = {}; export const group = { start: "Other" };', /which colors does not name/],
  ["null sequence step", 'export const step = () => null;', /must return a string, but got null/, simpleSequence],
  ["missing function label", 'export const label = () => undefined;', /label.*must be a string/],
  ["bad map label", 'export const label = { start: 3 };', /label\["start"\] must be a string/],
  ["bad title", 'export const title = 3;', /title must be a string/],
  ["empty product", 'export const product = "";', /product must be a nonempty string/],
  ["bad colors object", 'export const colors = [];', /colors must be a plain object/],
  ["bad mapper", 'export const label = [];', /label must be a function or a plain object/],
  ["bad step", 'export const step = "label";', /step must be a function/],
  ["bad step answer", 'export const step = () => 3;', /step\(\).*a string or null/],
  ["async label", 'export const label = async () => "label";', /label.*must be a string/],
  ["throwing function", 'export const label = () => { throw new Error("cannot label"); };', /view failed for node.*cannot label/],
  ["bad branch label", 'export const label = (id, kind) => kind === "branch" ? null : id;', /label for branch "analyze" must be a string/, { ...simpleSequence, messages: [{ par: [simpleSequence.messages, simpleSequence.messages], branches: ["analyze", "show"] }] }],
];
for (const [name, source, error, model] of invalidViews) test(`view error: ${name}`, (t) => {
  const result = runModel(t, model ?? simpleFlow, source);
  assert.equal(result.status, 2, result.stderr);
  assert.match(result.stderr, error);
  assert.equal(fs.existsSync(result.out), false);
});

test("bad JSON and missing input files exit 2 without output", (t) => {
  const dir = scratch(t);
  const file = path.join(dir, "bad.json");
  fs.writeFileSync(file, "{not json}\n", "utf8");
  for (const input of [file, path.join(dir, "missing.json")]) {
    const result = run(input, path.join(dir, "out"));
    assert.equal(result.status, 2);
    assert.match(result.stderr, /Cannot read model JSON/);
    assert.equal(fs.existsSync(result.out), false);
  }
});

test("bad args exit 2 with usage and no output", (t) => {
  const dir = scratch(t);
  const out = path.join(dir, "out");
  for (const args of [[], ["a.json", "b.json"], ["a.json", "--unknown"], ["a.json", "--view"], ["a.json", "--fill=yes"]]) {
    const result = spawnSync(process.execPath, [cli, ...args, "--out", out], { encoding: "utf8" });
    assert.equal(result.status, 2);
    assert.match(result.stderr, /Usage: checkchart MODEL.json/);
    assert.equal(fs.existsSync(out), false);
  }
});

test("output must be new or empty; existing files remain untouched", (t) => {
  const dir = scratch(t);
  const file = path.join(dir, "model.json");
  const out = path.join(dir, "out");
  fs.writeFileSync(file, JSON.stringify(simpleFlow), "utf8");
  fs.mkdirSync(out);
  assert.equal(run(file, out).status, 1); // No view: PurposeStated fails, but files are published.
  const before = fs.readFileSync(path.join(out, "chart.mmd"));
  const second = run(file, out);
  assert.equal(second.status, 2);
  assert.match(second.stderr, /is not empty.*new or empty folder/);
  assert.deepEqual(fs.readFileSync(path.join(out, "chart.mmd")), before);
  const occupied = path.join(dir, "occupied");
  fs.writeFileSync(occupied, "keep\n", "utf8");
  assert.equal(run(file, occupied).status, 2);
  assert.equal(fs.readFileSync(occupied, "utf8"), "keep\n");
});

test("the output folder is checked again after the view runs", (t) => {
  const result = runModel(t, simpleFlow, `import fs from "node:fs";
fs.mkdirSync(new URL("./out/", import.meta.url));
fs.writeFileSync(new URL("./out/keep", import.meta.url), "keep\\n", "utf8");
export const label = (id) => id;
`);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /is not empty/);
  assert.equal(fs.readFileSync(path.join(result.out, "keep"), "utf8"), "keep\n");
  assert.equal(result.chart, "");
  assert.equal(result.report, "");
});

test("default output sits beside the model; nested new output folders work", (t) => {
  const dir = scratch(t);
  const file = path.join(dir, "facts.json");
  fs.writeFileSync(file, JSON.stringify(simpleFlow), "utf8");
  const result = spawnSync(process.execPath, [cli, file], { encoding: "utf8" });
  assert.equal(result.status, 1, result.stderr);
  assert.ok(fs.existsSync(path.join(dir, "facts-chart", "chart.mmd")));
  assert.equal(run(file, path.join(dir, "nested", "new", "out")).status, 1);
});
