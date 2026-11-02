import assert from "node:assert/strict";
import test from "node:test";
import { placeEdgeLabels, recoverEdgeLabelSpace, reserveCrossZoneLabelSpace } from "../backends/svg/labels.ts";
import { routeLayout } from "../backends/svg/route-layout.ts";
import { emptyScene, overlaps } from "../backends/svg/scene.ts";
import { fontSize, headerHeight, textBlock } from "../backends/svg/text.ts";
import { render } from "../backends/svg/render.ts";
import { assertSvgLabelAffinity } from "./visual-quality.ts";
import { layoutQuality } from "./svg-geometry.ts";

for (const direction of ["TB", "BT", "LR", "RL"] as const) test(`${direction} a narrow nested zone gap grows to hold its edge label`, () => {
  const scene = emptyScene(), text = textBlock("acme"), caption = textBlock("Starts acme\nor connects to\nan existing worker", 240, fontSize.label);
  scene.width = 600; scene.height = 600;
  const zone = (id: string, x: number, y: number, width: number, height: number, parent = "root") => ({
    id, parent, box: { x, y, width, height }, text, headerHeight: headerHeight(text), untrusted: false, classes: [],
  });
  scene.containers.push(zone("outer", 20, 20, 500, 500), zone("x", 60, 60, 280, 160, "outer"), zone("y", 60, 240, 280, 160, "outer"));
  scene.nodes.push({ id: "a", parent: "x", box: { x: 180, y: 130, width: 100, height: 40 }, text, shape: "box", classes: [] },
    { id: "b", parent: "y", box: { x: 180, y: 310, width: 100, height: 40 }, text, shape: "box", classes: [] });
  const horizontal = direction === "LR" || direction === "RL";
  for (const { box } of [...scene.nodes, ...scene.containers]) {
    if (horizontal) [box.x, box.y, box.width, box.height] = [box.y, box.x, box.height, box.width];
    if (direction === "BT") box.y = 600 - box.y - box.height;
    if (direction === "RL") box.x = 600 - box.x - box.width;
  }
  scene.edges.push({ id: "e0", source: "a", target: "b", sections: [], dashed: false, head: "filled",
    labels: [{ id: "e0-label", text: caption, box: { x: 0, y: 0, width: caption.width + 12, height: caption.height + 8 } }] });
  const result = routeLayout(scene, direction), label = result.edges[0].labels[0].box;
  const [outer, x, y] = result.containers;
  assert.ok(!overlaps(label, x.box) && !overlaps(label, y.box), "the label stays outside both endpoint zones");
  assert.ok(label.x >= outer.box.x && label.y >= outer.box.y && label.x + label.width <= outer.box.x + outer.box.width && label.y + label.height <= outer.box.y + outer.box.height);
  const space = horizontal ? Math.max(x.box.x, y.box.x) - Math.min(x.box.x + x.box.width, y.box.x + y.box.width)
    : Math.max(x.box.y, y.box.y) - Math.min(x.box.y + x.box.height, y.box.y + y.box.height);
  assert.ok(space >= (horizontal ? label.width : label.height) + 8 - 0.01);
});

test("growing a nested gap shifts following subtrees at every ancestor", () => {
  const scene = emptyScene(), text = textBlock("acme");
  scene.width = 600; scene.height = 720;
  const zone = (id: string, y: number, height: number, parent = "root") => ({
    id, parent, box: { x: 20, y, width: 500, height }, text, headerHeight: headerHeight(text), untrusted: false, classes: [],
  });
  scene.containers.push(zone("outer", 20, 500), zone("x", 60, 160, "outer"), zone("y", 240, 160, "outer"),
    zone("tail", 440, 40, "outer"), zone("outside", 560, 100));
  for (const [id, parent, y] of [["a", "x", 130], ["b", "y", 310], ["c", "tail", 450], ["d", "outside", 600]] as const) {
    scene.nodes.push({ id, parent, box: { x: 180, y, width: 100, height: 20 }, text, shape: "box", classes: [] });
  }
  scene.edges.push({ id: "e0", source: "a", target: "b", sections: [], dashed: false, head: "filled",
    labels: [{ id: "e0-label", text, box: { x: 0, y: 0, width: 80, height: 80 } }] });
  reserveCrossZoneLabelSpace(scene, "TB");
  assert.equal(scene.containers.find((zone) => zone.id === "y")!.box.y, 308);
  assert.equal(scene.containers.find((zone) => zone.id === "tail")!.box.y, 508);
  assert.equal(scene.containers.find((zone) => zone.id === "outside")!.box.y, 628);
  assert.equal(scene.nodes.find((node) => node.id === "c")!.box.y, 518);
  assert.equal(scene.nodes.find((node) => node.id === "d")!.box.y, 668);
});

test("an unzoned label uses the route midpoint even when it is off the longest segment", () => {
  const scene = emptyScene(), text = textBlock("acme");
  scene.edges.push({ id: "e0", sections: [[{ x: 40, y: 40 }, { x: 40, y: 220 }, { x: 160, y: 220 }, { x: 160, y: 340 }]],
    dashed: false, head: "filled", labels: [{ id: "e0-label", text, box: { x: 0, y: 0, width: 40, height: 20 } }] });
  placeEdgeLabels(scene, "TB", scene.edges);
  const box = scene.edges[0].labels[0].box;
  assert.equal(box.x + box.width / 2, 70, "the pill centers on the midpoint of the 420px route");
  assert.equal(box.y + box.height, 216, "the pill remains 4px from its own horizontal segment");
});

for (const horizontal of [false, true]) for (const blocked of [false, true]) test(`crowded ${horizontal ? "horizontal" : "vertical"} lanes widen before accepting a label fallback${blocked ? " under an obstruction" : ""}`, () => {
  let scene = emptyScene();
  scene.width = 400; scene.height = 400;
  const text = textBlock("acme"), transform = (x: number, y: number) => horizontal ? { x: y, y: x } : { x, y };
  if (blocked) scene.notes.push({ id: "obstruction", text, box: { x: 0, y: 0, width: 400, height: 400 } });
  scene.edges = [100, 80, 120].map((x, i) => ({ id: `e${i}`, source: `a${i}`, target: `b${i}`,
    sections: [[transform(x, 20), transform(x, 200)], [transform(x, 200), transform(x, 380)]],
    labels: i ? [] : [{ id: "e0-label", text, box: { x: 0, y: 0, width: 90, height: 50 } }], dashed: false, head: "filled" }));
  placeEdgeLabels(scene, horizontal ? "LR" : "TB", scene.edges);
  assert.equal(scene.edges[0].labels[0].onRoute, true, "both sides initially contain a neighbouring lane");
  scene = recoverEdgeLabelSpace(scene, horizontal ? "LR" : "TB");
  assert.ok(horizontal ? scene.height > 400 : scene.width > 400);
  assert.equal(!!scene.edges[0].labels[0].onRoute, blocked, "only the text obstruction requires a pill over the line");
  for (const edge of scene.edges) assert.deepEqual(edge.sections[0].at(-1), edge.sections[1][0], "section joins survive the spacing change");
  assertSvgLabelAffinity(render(scene, "acme", []));
  if (!blocked) assert.deepEqual(scene.warnings, []);
  else assert.ok(scene.warnings.some((warning) => /e0 label.*longest segment/.test(warning.detail)));
});

test("an exhausted label stays on its longest segment with an opaque white pill and warning", () => {
  let scene = emptyScene();
  scene.width = 400; scene.height = 400;
  const text = textBlock("acme");
  scene.notes.push({ id: "obstruction", text, box: { x: 0, y: 0, width: 400, height: 400 } });
  scene.edges.push({ id: "e0", source: "a", target: "b", sections: [[{ x: 100, y: 20 }, { x: 100, y: 320 }, { x: 300, y: 320 }]],
    labels: [{ id: "e0-label", text, box: { x: 0, y: 0, width: 80, height: 30 } }], dashed: false, head: "filled" });
  placeEdgeLabels(scene, "TB", scene.edges);
  scene = recoverEdgeLabelSpace(scene, "TB");
  const edge = scene.edges[0], label = edge.labels[0];
  assert.equal(label.onRoute, true);
  assert.equal(label.box.x + label.box.width / 2, 100);
  assert.equal(label.box.y + label.box.height / 2, 170);
  const original = structuredClone(edge.sections), svg = render(scene, "acme", []);
  assert.deepEqual(edge.sections, original, "the final text pass keeps the line under its own pill");
  assertSvgLabelAffinity(svg);
  assert.match(svg, /class="pill"[^>]*style="fill:#fff"/);
  assert.ok(scene.warnings.some((warning) => warning.rule === "LayoutCompromise" && /e0 label.*longest segment/.test(warning.detail)));
});

test("a collapsed fallback route anchors its label at its own endpoint", () => {
  const scene = emptyScene(), text = textBlock("acme");
  scene.width = 400; scene.height = 400;
  scene.edges.push({ id: "e0", source: "a", target: "a", sections: [[{ x: 200, y: 200 }]],
    labels: [{ id: "e0-label", text, box: { x: 0, y: 0, width: 80, height: 30 } }], dashed: false, head: "filled" },
  { id: "e1", source: "b", target: "c", sections: [[{ x: 40, y: 20 }, { x: 40, y: 300 }]], labels: [], dashed: false, head: "filled" });
  placeEdgeLabels(scene, "TB", scene.edges);
  const label = scene.edges[0].labels[0];
  assert.equal(label.onRoute, true);
  assert.equal(label.box.x + label.box.width / 2, 200);
  assert.equal(label.box.y + label.box.height / 2, 200);
  assertSvgLabelAffinity(render(scene, "acme", []));
});

test("the geometry audit exempts only the owning line of an explicit on-route fallback", () => {
  const model = { kind: "flow", direction: "TB", nodes: {}, edges: [] } as const;
  const svg = '<svg width="300" height="300"><g id="edge-e0"><path data-points="100,20 100,200"/></g>'
    + '<g id="edge-e1"><path data-points="110,20 110,200"/></g>'
    + '<g id="label-e0-label" data-pill="80 80 40 30" data-on-route="true"><rect class="pill" style="fill:#fff"/></g></svg>';
  assert.deepEqual(layoutQuality(svg, model).textCollisions, ["e1 / label-e0-label segment 1"]);
  assert.deepEqual(layoutQuality(svg.replace(' data-on-route="true"', ""), model).textCollisions,
    ["e0 / label-e0-label segment 1", "e1 / label-e0-label segment 1"]);
  assert.throws(() => assertSvgLabelAffinity(svg), /not closest/);
});

for (const horizontal of [false, true]) test(`coincident ${horizontal ? "horizontal" : "vertical"} routes keep the fallback on its owning line`, () => {
  let scene = emptyScene();
  scene.width = 400; scene.height = 400;
  const text = textBlock("acme"), point = (x: number, y: number) => horizontal ? { x: y, y: x } : { x, y };
  scene.edges = [0, 1].map((i) => ({ id: `e${i}`, source: `a${i}`, target: `b${i}`, sections: [[point(100, 20), point(100, 380)]],
    labels: i ? [] : [{ id: "e0-label", text, box: { x: 0, y: 0, width: 90, height: 50 } }], dashed: false, head: "filled" }));
  placeEdgeLabels(scene, horizontal ? "LR" : "TB", scene.edges);
  scene = recoverEdgeLabelSpace(scene, horizontal ? "LR" : "TB");
  const original = structuredClone(scene.edges[0].sections);
  assert.equal(scene.edges[0].labels[0].onRoute, true);
  assertSvgLabelAffinity(render(scene, "acme", []));
  assert.deepEqual(scene.edges[0].sections, original, "the other route yields to the opaque fallback");
});
