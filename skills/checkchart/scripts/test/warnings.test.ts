import assert from "node:assert/strict";
import test from "node:test";
import { parseModel } from "../frontends/model.ts";
import { answersOf, checkView } from "../frontends/view.ts";
import { checkReadability, crossingWarnings, widthWarnings } from "../passes/readability.ts";
import { runModel, simpleArchitecture, simpleFlow, simpleSequence } from "./helpers.ts";

const purpose = { title: "acme workflow", reader: "A maintainer", question: "How does a request finish?" };
const viewSource = Object.entries(purpose).map(([key, value]) => `export const ${key} = ${JSON.stringify(value)};`).join("\n");
function warnings(raw: unknown, view: Record<string, unknown> = {}) {
  const model = parseModel(raw);
  const answers = answersOf(model, checkView({ ...purpose, step: () => "Sends a request", ...view }));
  return checkReadability(model, answers).warnings ?? [];
}
const named = (raw: unknown, rule: string, view: Record<string, unknown> = {}) => warnings(raw, view).filter((warning) => warning.rule === rule);

test("WideChart uses the final SVG width and warns only above 1100px", () => {
  assert.deepEqual(widthWarnings(1000), []);
  assert.deepEqual(widthWarnings(1100), []);
  assert.deepEqual(widthWarnings(1100.004), []);
  assert.deepEqual(widthWarnings(1100.01), [{ rule: "WideChart", detail: "The chart is 1100.01 px wide; documents shrink it and the text gets small. Shorten the labels, split the chart, or use direction TB." }]);
});

test("DeepNesting starts at three zone levels, names the chain and ignores invalid ancestry", () => {
  const zones = { outer: {}, inner: { parent: "outer" } };
  assert.equal(named({ ...simpleArchitecture, zones }, "DeepNesting").length, 0);
  const deep = named({ ...simpleArchitecture, zones: { ...zones, leaf: { parent: "inner" } } }, "DeepNesting");
  assert.equal(deep.length, 1);
  assert.match(deep[0].detail, /outer.*inner.*leaf/);
  assert.match(deep[0].detail, /Split|Flatten/);
  assert.equal(named({ ...simpleArchitecture, zones: { a: { parent: "b" }, b: { parent: "a" }, c: { parent: "missing" } } }, "DeepNesting").length, 0);
});

test("TwoWayArrow names both ends, gives the prescribed advice and leaves one-way arrows quiet", () => {
  assert.equal(named(simpleArchitecture, "TwoWayArrow").length, 0);
  const found = named({ ...simpleArchitecture, connections: [{ from: "screen", to: "core", dir: "both" }] }, "TwoWayArrow");
  assert.equal(found.length, 1);
  assert.match(found[0].detail, /screen.*core/);
  assert.match(found[0].detail, /Split it into two one-way arrows, or say what goes each way in the label/);
  assert.equal(named({ ...simpleArchitecture, connections: [{ from: "screen", to: "missing", dir: "both" }] }, "TwoWayArrow").length, 0);
});

for (const label of ["uses", "use", "calls", "call", "connects", "connect", "talks to", "使う", "呼ぶ", "接続", "連携", "通信", " USES. ", "Calls!", "通信。", " Talks To... "]) {
  test(`GenericLabel recognizes only a generic label: ${label}`, () => {
    for (const raw of [simpleFlow, simpleSequence, simpleArchitecture]) {
      const found = named(raw, "GenericLabel", { step: () => label });
      assert.equal(found.length, 1);
      assert.match(found[0].detail, /start.*done|screen.*core/);
      assert.match(found[0].detail, /Describe/);
      assert.equal(named(raw, "GenericLabel", { step: () => label.trim() + " the request" }).length, 0);
    }
  });
}

test("Crossings warns only for a measured positive count", (t) => {
  assert.deepEqual(crossingWarnings(0), []);
  assert.equal(crossingWarnings(1).length, 1);
  assert.match(crossingWarnings(3)[0].detail, /3 crossings.*Reroute|3 crossings.*Split/);
  const plain = runModel(t, simpleFlow, viewSource);
  assert.equal(plain.status, 0, plain.stderr);
  assert.match(plain.report.split("## Checks not made")[1], /Crossings.*--svg/);
  const measured = runModel(t, simpleFlow, viewSource, ["--svg"]);
  assert.equal(measured.status, 0, measured.stderr);
  assert.doesNotMatch(measured.report, /Crossings/);
  const sequence = runModel(t, simpleSequence, viewSource);
  assert.doesNotMatch(sequence.report, /Crossings/);
});

for (const kind of ["flow", "architecture", "sequence"]) test(`TooManyElements ${kind} count warns only above the limit`, () => {
  const limit = kind === "sequence" ? 6 : 12;
  const model = (count: number) => {
    const ids = Array.from({ length: count }, (_, index) => `item${index}`);
    return kind === "flow" ? { kind, nodes: Object.fromEntries(ids.map((id) => [id, {}])), edges: [] }
      : kind === "architecture" ? { kind, components: Object.fromEntries(ids.map((id) => [id, {}])), connections: [] }
      : { kind, participants: ids, messages: [] };
  };
  assert.equal(named(model(limit), "TooManyElements").length, 0);
  const found = named(model(limit + 1), "TooManyElements");
  assert.equal(found.length, 1);
  assert.ok(found[0].detail.includes(String(limit + 1)));
  assert.match(found[0].detail, /item0/);
  assert.match(found[0].detail, /Split/);
});

test("TooManyElements counts both child zones and direct components in each zone", () => {
  const model = (count: number) => ({ ...simpleArchitecture, zones: { outer: {}, child: { parent: "outer" } }, components: Object.fromEntries(Array.from({ length: count }, (_, index) => [`item${index}`, { zone: "outer" }])) });
  assert.equal(named(model(4), "TooManyElements").length, 0);
  const found = named(model(5), "TooManyElements");
  assert.equal(found.length, 1);
  assert.match(found[0].detail, /outer.*6.*child.*item0/);
});

test("TooManyElements checks every nested par at five branches", () => {
  const model = (count: number) => ({ ...simpleSequence, messages: [{ par: [[{ par: Array.from({ length: count }, () => simpleSequence.messages), branches: Array.from({ length: count }, (_, index) => `branch${index}`) }], []] }] });
  assert.equal(named(model(5), "TooManyElements").length, 0);
  const found = named(model(6), "TooManyElements");
  assert.equal(found.length, 1);
  assert.match(found[0].detail, /par.*6.*branch0/);
});

test("TooManyElements counts used color groups, excluding unused palette entries", () => {
  const colors = Object.fromEntries(Array.from({ length: 7 }, (_, index) => [`Group${index}`, "teal"]));
  const raw = { kind: "flow", nodes: Object.fromEntries(Object.keys(colors).map((id) => [id, {}])), edges: [] };
  const groups = (count: number) => ({ colors, group: (id: string) => Number(id.slice(5)) < count ? id : undefined });
  assert.equal(named(raw, "TooManyElements", groups(6)).length, 0);
  const seven = named(raw, "TooManyElements", groups(7));
  assert.equal(seven.length, 1);
  assert.match(seven[0].detail, /7.*color groups.*Group0/);
  assert.match(seven[0].detail, /Reduce|Split/);
});

test("MixedLevels accepts every optional level and warns only when specified levels differ", () => {
  assert.equal(named(simpleArchitecture, "MixedLevels").length, 0);
  for (const level of ["context", "container", "component", "code", "deployment"]) {
    const raw = { ...simpleArchitecture, components: { screen: { level }, core: { level } } };
    assert.equal(named(raw, "MixedLevels").length, 0);
    assert.equal(named({ ...raw, components: { screen: { level }, core: {} } }, "MixedLevels").length, 0);
  }
  const found = named({ ...simpleArchitecture, components: { screen: { level: "context" }, core: { level: "component" } } }, "MixedLevels");
  assert.equal(found.length, 1);
  assert.match(found[0].detail, /screen.*context.*core.*component/);
  assert.match(found[0].detail, /separate charts/);
  assert.throws(() => parseModel({ ...simpleArchitecture, components: { core: { level: "unknown" } } }), /level.*context.*deployment/);
  assert.throws(() => parseModel({ ...simpleArchitecture, components: { core: { level: null } } }), /level/);
});

test("FlowLoopsBack counts edges returning to earlier nodes in the declared main order", () => {
  const model = (count: number) => ({ kind: "flow", nodes: { start: { type: "start" }, first: {}, second: {}, third: {}, done: { type: "end" } }, edges: [
    { from: "start", to: "first" }, { from: "first", to: "second" }, { from: "second", to: "third" }, { from: "third", to: "done" },
    ...[{ from: "second", to: "first" }, { from: "third", to: "first" }, { from: "third", to: "second" }].slice(0, count),
  ] });
  assert.equal(named(model(2), "FlowLoopsBack").length, 0);
  const found = named(model(3), "FlowLoopsBack");
  assert.equal(found.length, 1);
  assert.match(found[0].detail, /3.*second.*first.*third/);
  assert.match(found[0].detail, /sequence diagram/);
});

test("warnings are before rules that hold and do not change success or rule-failure exits", (t) => {
  const raw = { ...simpleArchitecture, connections: [{ from: "screen", to: "core", dir: "both" }] };
  const view = viewSource + 'export const step = () => "Uses.";';
  const result = runModel(t, raw, view);
  assert.equal(result.status, 0, result.stderr || result.report);
  assert.match(result.report, /## Warnings\n- TwoWayArrow:.*\n- GenericLabel:/);
  assert.ok(result.report.indexOf("## Warnings") < result.report.indexOf("## Rules that hold"));
  const broken = runModel(t, { ...raw, components: { ...raw.components, alone: {} } }, view);
  assert.equal(broken.status, 1, broken.stderr);
  assert.match(broken.report, /## Warnings/);
});
