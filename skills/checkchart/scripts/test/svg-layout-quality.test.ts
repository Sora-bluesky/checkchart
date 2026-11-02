import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import ELK from "elkjs/lib/elk.bundled.js";
import { loadModel, parseModel } from "../frontends/model.ts";
import { answersOf, loadView } from "../frontends/view.ts";
import { graphScene } from "../backends/svg/graph.ts";
import { render } from "../backends/svg/render.ts";
import { exitRoute } from "../backends/svg/routing.ts";
import { run, scratch } from "./helpers.ts";
import { assertLayoutQuality, layoutQuality } from "./svg-geometry.ts";

for (const name of ["architecture-layout-tb", "architecture-fanout-tb"]) test(`${name} SVG has tight zones and collision-free wrapped edge labels`, (t) => {
  const dir = path.join(import.meta.dirname, "fixtures", name);
  const model = loadModel(path.join(dir, "model.json"));
  const result = run(path.join(dir, "model.json"), path.join(scratch(t), "out"), path.join(dir, "view.mjs"), ["--svg"]);
  assert.equal(result.status, 0, result.stderr || result.report);
  const svg = fs.readFileSync(path.join(result.out, "chart.svg"), "utf8");
  const quality = assertLayoutQuality(svg, model);
  assert.ok(quality.labels >= 10);
  for (const pill of svg.matchAll(/<g id="label-[^"]+"[^>]*>(.*?)<\/g>/g)) assert.equal([...pill[1].matchAll(/<tspan /g)].length, 2);
});

test("nested zones and boundary routes retain their geometry in every reading direction", async () => {
  const dir = path.join(import.meta.dirname, "fixtures", "architecture-layout-tb");
  const facts = loadModel(path.join(dir, "model.json"));
  const view = await loadView(path.join(dir, "view.mjs"));
  for (const direction of ["TB", "TD", "BT", "LR", "RL"]) {
    const model = parseModel({ ...facts, direction });
    if (model.kind !== "architecture") continue;
    const scene = await graphScene(model, answersOf(model, view), { rules: [], bugs: [], unchecked: [] }, new ELK())
      .catch((error) => { throw new Error(`${direction}: ${error.message}`); });
    const quality = assertLayoutQuality(render(scene, "acme", []), model);
    assert.equal(quality.nodes, 11);
    assert.equal(quality.edges, 11);
    // Part 5 resolves the face from actual placement. A compact layout may
    // stack a locally LR region vertically; the port must still face its peer.
    const observer = scene.edges.find((edge) => edge.dashed);
    assert.ok(observer);
    const first = observer.sections[0];
    assert.ok(first?.length);
    const end = first.at(-1)!;
    const port = scene.containers.flatMap((zone) => zone.ports ?? []).find((port) => port.edge === observer.id &&
      !port.incoming && Math.hypot(port.point.x - end.x, port.point.y - end.y) < 0.02);
    assert.ok(port, `${direction} observer must leave through its declared port`);
    const target = scene.nodes.find((node) => node.id === observer.target)!;
    const normals = { NORTH: [0, -1], SOUTH: [0, 1], EAST: [1, 0], WEST: [-1, 0] };
    const [nx, ny] = normals[port.side];
    assert.ok((target.box.x + target.box.width / 2 - port.point.x) * nx + (target.box.y + target.box.height / 2 - port.point.y) * ny > 0);
  }
});

test("an exit detours around a sibling without detaching its ends or crossing the sibling", () => {
  const start = { x: 20, y: 50 }, end = { x: 200, y: 50 };
  const obstacle = { x: 60, y: 30, width: 80, height: 40 };
  const path = exitRoute(start, end, [obstacle], { x: 0, y: 0, width: 200, height: 100 });
  assert.deepEqual(path[0], start);
  assert.deepEqual(path.at(-1), end);
  assert.ok(path.length >= 4);
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i];
    assert.ok(a.x === b.x || a.y === b.y);
    assert.ok(Math.max(a.x, b.x) <= obstacle.x || Math.min(a.x, b.x) >= obstacle.x + obstacle.width ||
      Math.max(a.y, b.y) <= obstacle.y || Math.min(a.y, b.y) >= obstacle.y + obstacle.height);
  }
  assert.deepEqual(exitRoute(start, end, [], { x: 0, y: 0, width: 200, height: 100 }), [start, end]);
});

test("geometry audit detects label collisions with labels, nodes and different edges", () => {
  const svg = '<g id="node-n0" data-node="20 20 40 40"></g>'
    + '<g id="label-e0-label" data-pill="10 10 40 40"></g><g id="label-e1-label" data-pill="15 15 40 40"></g>'
    + '<g id="edge-e0"><path data-points="0,30 100,30"/></g><g id="edge-e2"><path data-points="0,40 100,40"/></g>';
  const quality = layoutQuality(svg, { kind: "flow", direction: "TB", nodes: {}, edges: [] });
  assert.ok(quality.collisions.includes("e0-label / e1-label"));
  assert.ok(quality.collisions.includes("e0-label / n0"));
  assert.ok(quality.collisions.includes("e0-label / e2 segment 1"));
  assert.ok(!quality.collisions.some((pair) => pair.startsWith("e0-label / e0 ")));
});

test("geometry audit catches edges through zone headers, node text and a translated legend", () => {
  const svg = '<g data-diagram="24 100 200 200">'
    + '<g id="container-z0" data-container="0 0 100 100"><text data-text="12 6 76 20"></text></g>'
    + '<g id="node-n0" data-node="20 40 80 40"><text data-text="36 50 48 20"></text></g>'
    + '<g id="edge-e0"><path data-points="50,0 50,90"/></g>'
    + '<g id="edge-e1"><path data-points="120,-80 180,-80"/></g></g>'
    + '<g id="legend" data-legend="150 10 40 40"></g>';
  const quality = layoutQuality(svg, { kind: "flow", direction: "TB", nodes: {}, edges: [] });
  assert.equal(quality.textBoxes, 3);
  assert.deepEqual(quality.textCollisions, ["e0 / container-z0 segment 1", "e0 / node-n0 segment 1", "e1 / legend segment 1"]);
});
