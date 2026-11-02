import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import ELK from "elkjs/lib/elk.bundled.js";
import { parseModel } from "../frontends/model.ts";
import { answersOf, checkView } from "../frontends/view.ts";
import { mainPath } from "../passes/flow.ts";
import { graphScene } from "../backends/svg/graph.ts";
import { countCrossings } from "../backends/svg/crossings.ts";
import type { Point } from "../backends/svg/scene.ts";
import { runModel, simpleFlow } from "./helpers.ts";

const edge = (id: string, ...sections: Point[][]) => ({ id, sections });
const p = (x: number, y: number) => ({ x, y });

test("crossings count distinct transverse intersections between different edges", () => {
  const horizontal = edge("a", [p(0, 10), p(20, 10)]);
  assert.equal(countCrossings([horizontal]), 0);
  assert.equal(countCrossings([horizontal, edge("b", [p(10, 0), p(10, 20)])]), 1);
  assert.equal(countCrossings([horizontal, edge("b", [p(10, 0), p(10, 10), p(10, 20)])]), 1);
  assert.equal(countCrossings([horizontal, edge("b", [p(5, 0), p(5, 20)], [p(15, 0), p(15, 20)])]), 2);
  assert.equal(countCrossings([edge("a", [p(0, 0), p(20, 20)]), edge("b", [p(0, 20), p(20, 0)])]), 1);
  assert.equal(countCrossings([edge("a", [p(0, 0), p(20, 20)]), edge("b", [p(10, 0), p(10, 10), p(0, 10)])]), 1);
});

test("crossings exclude shared ends, T contacts, collinear routes, bends that touch and self-intersections", () => {
  const horizontal = edge("a", [p(0, 10), p(20, 10)]);
  for (const other of [
    edge("b", [p(20, 10), p(20, 20)]),
    edge("b", [p(10, 0), p(10, 10)]),
    edge("b", [p(5, 10), p(15, 10)]),
    edge("b", [p(10, 0), p(10, 10), p(20, 10)]),
    edge("b", [p(0, 0), p(0, 0)]),
  ]) assert.equal(countCrossings([horizontal, other]), 0);
  assert.equal(countCrossings([edge("a", [p(0, 0), p(20, 0), p(20, 20), p(10, 20), p(10, -10)])]), 0);
});

const branching = {
  kind: "flow", nodes: { start: { type: "start" }, choose: { type: "decision" }, first: {}, other: {}, extra: {}, done: { type: "end" } },
  edges: [{ from: "start", to: "choose" }, { from: "choose", to: "first", when: "failure" }, { from: "choose", to: "other", when: "success" }, { from: "first", to: "done" }, { from: "other", to: "extra" }, { from: "extra", to: "done" }],
};

test("main path follows the first decision edge even when the other branch is longer or called success", () => {
  const model = parseModel(branching);
  assert.equal(model.kind, "flow");
  if (model.kind !== "flow") return;
  assert.deepEqual(mainPath(model).map((edge) => edge.to), ["choose", "first", "done"]);
  const swapped = parseModel({ ...branching, edges: [branching.edges[0], branching.edges[2], branching.edges[1], ...branching.edges.slice(3)] });
  if (swapped.kind !== "flow") return;
  assert.deepEqual(mainPath(swapped).map((edge) => edge.to), ["choose", "other", "extra", "done"]);
});

test("main path picks the longest eligible simple path, handles cycles, multiple starts and missing ends", () => {
  const model = parseModel({ ...simpleFlow, nodes: { ...simpleFlow.nodes, alternate: { type: "start" }, first: {}, second: {} }, edges: [
    ...simpleFlow.edges, { from: "alternate", to: "first" }, { from: "first", to: "second" }, { from: "second", to: "first" }, { from: "second", to: "done" },
  ] });
  if (model.kind !== "flow") return;
  assert.deepEqual(mainPath(model).map((edge) => edge.from), ["alternate", "first", "second"]);
  const invalid = parseModel({ kind: "flow", nodes: { start: { type: "start" } }, edges: [{ from: "start", to: "start" }] });
  if (invalid.kind === "flow") assert.deepEqual(mainPath(invalid), []);
});

test("main path gets high ELK straightness and direction priorities, other edges keep their defaults", async () => {
  const model = parseModel(branching);
  if (model.kind !== "flow") return;
  const answers = answersOf(model, checkView({}));
  let observed = false;
  const elk = new ELK();
  const layout = elk.layout.bind(elk);
  elk.layout = async (root, options) => {
    observed = true;
    for (const [index, edge] of (root.edges ?? []).entries()) {
      if ([0, 1, 3].includes(index)) {
        assert.ok(Number(edge.layoutOptions?.["elk.layered.priority.straightness"]) > 1);
        assert.ok(Number(edge.layoutOptions?.["elk.layered.priority.direction"]) > 1);
      } else assert.equal(edge.layoutOptions?.["elk.layered.priority.straightness"], undefined);
    }
    return layout(root, options);
  };
  await graphScene(model, answers, { rules: [], bugs: [], unchecked: [] }, elk);
  assert.ok(observed);
});

test("the first-branch flow path lines up within 1px in TB SVG and remains deterministic", (t) => {
  const view = 'export const title = "acme request"; export const reader = "A maintainer"; export const question = "How is a request handled?";';
  const model = { kind: "flow", direction: "TB", nodes: { start: { type: "start" }, choose: { type: "decision" }, first: {}, other: {}, done: { type: "end" } }, edges: [
    { from: "start", to: "choose" }, { from: "choose", to: "first", when: "first" }, { from: "choose", to: "other", when: "other" }, { from: "first", to: "done" }, { from: "other", to: "done" },
  ] };
  const first = runModel(t, model, view, ["--svg"]);
  const second = runModel(t, model, view, ["--svg"]);
  assert.equal(first.status, 0, first.stderr || first.report);
  const image = fs.readFileSync(path.join(first.out, "chart.svg"), "utf8");
  assert.equal(image, fs.readFileSync(path.join(second.out, "chart.svg"), "utf8"));
  const centers = [...image.matchAll(/id="node-n(\d+)"[^>]*data-node="([^"]+)"/g)]
    .filter((match) => [0, 1, 2, 4].includes(Number(match[1])))
    .map((match) => { const [x, , width] = match[2].split(" ").map(Number); return x + width / 2; });
  assert.equal(centers.length, 4);
  assert.ok(Math.max(...centers) - Math.min(...centers) <= 1, JSON.stringify(centers));
});

test("main-path centers align along the reading axis in every direction", async () => {
  for (const direction of ["TB", "TD", "BT", "LR", "RL"]) {
    const model = parseModel({ ...branching, direction });
    if (model.kind !== "flow") continue;
    const scene = await graphScene(model, answersOf(model, checkView({})), { rules: [], bugs: [], unchecked: [] }, new ELK());
    const centers = scene.nodes.filter((node) => ["n0", "n1", "n2", "n5"].includes(node.id)).map((node) =>
      ["LR", "RL"].includes(direction) ? node.box.y + node.box.height / 2 : node.box.x + node.box.width / 2);
    assert.equal(centers.length, 4);
    assert.ok(Math.max(...centers) - Math.min(...centers) <= 1, direction + ": " + JSON.stringify(centers));
  }
});

test("architecture SVG reports measured crossings without changing the success exit", (t) => {
  const ids = ["a", "b", "c", "d", "e", "f"];
  const model = { kind: "architecture", direction: "LR", components: Object.fromEntries(ids.map((id) => [id, {}])), connections: ids.slice(0, 3).flatMap((from) => ids.slice(3).map((to) => ({ from, to }))) };
  const view = 'export const title = "acme exchanges"; export const reader = "A maintainer"; export const question = "Which workers receive data?"; export const step = () => "Sends data";';
  const result = runModel(t, model, view, ["--svg"]);
  assert.equal(result.status, 0, result.stderr || result.report);
  const svg = fs.readFileSync(path.join(result.out, "chart.svg"), "utf8");
  const edges = [...svg.matchAll(/<g id="edge-([^"]+)"[^>]*>(.*?)<\/g>/g)].map((match) => ({ id: match[1],
    sections: [...match[2].matchAll(/data-points="([^"]+)"/g)].map((section) => section[1].split(" ").map((point) => {
      const [x, y] = point.split(",").map(Number); return { x, y };
    })),
  }));
  const crossings = countCrossings(edges);
  assert.ok(crossings > 0);
  assert.ok(result.report.includes(`Crossings: The final layout has ${crossings} crossings between arrows`));
  assert.doesNotMatch(result.report.split("## Checks not made")[1], /Crossings/);
});
