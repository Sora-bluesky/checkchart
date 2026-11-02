import assert from "node:assert/strict";
import test from "node:test";
import { routeGraphLines } from "../backends/svg/line-routing.ts";
import { render } from "../backends/svg/render.ts";
import { emptyScene, type Box, type Point, type Scene } from "../backends/svg/scene.ts";
import { textBlock } from "../backends/svg/text.ts";
import type { Direction } from "../ir.ts";
import { assertLineQuality } from "./svg-line-geometry.ts";
import { assertVisualLimits, visualQuality } from "./visual-quality.ts";

const flat = (scene: Scene, id: string) => scene.edges.find((edge) => edge.id === id)!.sections.flat()
  .filter((p, i, all) => !i || p.x !== all[i - 1].x || p.y !== all[i - 1].y)
  .filter((p, i, all) => !i || i === all.length - 1 ||
    !(all[i - 1].x === p.x && p.x === all[i + 1].x || all[i - 1].y === p.y && p.y === all[i + 1].y));

function fixture(kind: "fanout" | "incoming" | "outgoing", direction: Direction, zones = false) {
  const scene = emptyScene();
  scene.width = 800; scene.height = 800;
  const text = textBlock("acme");
  const boxes: Box[] = kind === "incoming"
    ? [{ x: 100, y: 100, width: 200, height: 60 }, { x: 100, y: 300, width: 200, height: 100 }, { x: 400, y: 100, width: 200, height: 60 }]
    : [{ x: 100, y: 100, width: 200, height: kind === "outgoing" ? 100 : 60 }, { x: 100, y: 400, width: 200, height: 60 }, { x: 400, y: 400, width: 200, height: 60 }];
  const horizontal = direction === "LR" || direction === "RL";
  const transform = (box: Box): Box => {
    const b = horizontal ? { x: box.y, y: box.x, width: box.height, height: box.width } : { ...box };
    if (direction === "BT") b.y = 800 - b.y - b.height;
    if (direction === "RL") b.x = 800 - b.x - b.width;
    return b;
  };
  scene.nodes = boxes.map((box, i) => ({ id: `n${i}`, box: transform(box), text, classes: [],
    shape: kind === "incoming" && i === 1 || kind === "outgoing" && i === 0 ? "decision" : "box",
    parent: zones ? i === 0 ? "z0" : "z1" : "root" }));
  if (zones) scene.containers = [
    { id: "z0", box: transform({ x: 60, y: 40, width: 280, height: 200 }), text, headerHeight: 24, untrusted: false, classes: [] },
    { id: "z1", box: transform({ x: 60, y: 340, width: 600, height: 200 }), text, headerHeight: 24, untrusted: false, classes: [] },
  ];
  scene.edges = [["n0", "n1"], kind === "incoming" ? ["n2", "n1"] : ["n0", "n2"]]
    .map(([source, target], i) => ({ id: `e${i}`, source, target, sections: [], dashed: false, head: "filled", labels: [] }));
  return scene;
}

for (const direction of ["TB", "TD", "BT", "LR", "RL"] as const) {
  for (const kind of ["fanout", "incoming", "outgoing"] as const) test(`${direction} ${kind}: straight first, off-axis L, diamond vertices`, () => {
    const scene = fixture(kind, direction);
    routeGraphLines(scene, direction);
    const main = flat(scene, "e0"), branch = flat(scene, "e1");
    assert.equal(main.length - 2, 0, "the aligned edge has zero bends");
    const axis = direction === "LR" || direction === "RL" ? "y" : "x";
    const extent = axis === "x" ? "width" : "height";
    const box = scene.nodes[0].box;
    assert.equal(main[0][axis], box[axis] + box[extent] / 2, "the aligned edge uses the shared center");
    assert.equal(branch.length - 2, 1, "the off-axis edge uses exactly one bend");
    const diamond = scene.nodes.find((node) => node.shape === "decision");
    if (diamond) {
      const { x, y, width, height } = diamond.box;
      const vertices: Point[] = [{ x: x + width / 2, y }, { x: x + width / 2, y: y + height },
        { x, y: y + height / 2 }, { x: x + width, y: y + height / 2 }];
      const ends = scene.edges.map((edge) => {
        const points = flat(scene, edge.id);
        return edge.source === diamond.id ? points[0] : points.at(-1)!;
      });
      for (const point of ends) assert.ok(vertices.some((v) => v.x === point.x && v.y === point.y), "diamond attaches at a vertex");
      assert.equal(new Set(ends.map((p) => `${p.x},${p.y}`)).size, ends.length, "one edge per vertex");
    }
  });
  test(`${direction} straight-first allocation also crosses zone borders`, () => {
    const scene = fixture("fanout", direction, true);
    routeGraphLines(scene, direction);
    assert.equal(flat(scene, "e0").length - 2, 0);
  });
}

for (const overlap of [16, 20, 100]) test(`partial overlap ${overlap}px uses its center`, () => {
  const scene = fixture("fanout", "TB");
  scene.edges.pop(); scene.nodes.pop();
  scene.nodes[1].box.x = scene.nodes[0].box.x + scene.nodes[0].box.width - overlap;
  const expected = scene.nodes[1].box.x + overlap / 2;
  routeGraphLines(scene, "TB");
  assert.deepEqual(flat(scene, "e0"), [
    { x: expected, y: scene.nodes[0].box.y + scene.nodes[0].box.height },
    { x: expected, y: scene.nodes[1].box.y },
  ]);
});

// A zone blocks one side of the shared center, while a corner-safe lane still
// reaches both boxes. Reflect and rotate the same geometry for every direction.
function obstructedFixture(direction: Direction, left = false) {
  const scene = fixture("fanout", "TB");
  scene.edges.pop(); scene.nodes.pop();
  const text = textBlock("acme");
  scene.containers = [{ id: "obstacle", box: { x: 180, y: 240, width: 180, height: 100 },
    text, headerHeight: 24, untrusted: false, classes: [] }];
  for (const item of [...scene.nodes, ...scene.containers]) {
    let b = item.box;
    if (left) b = { ...b, x: 400 - b.x - b.width };
    if (direction === "LR" || direction === "RL") b = { x: b.y, y: b.x, width: b.height, height: b.width };
    if (direction === "BT") b = { ...b, y: 800 - b.y - b.height };
    if (direction === "RL") b = { ...b, x: 800 - b.x - b.width };
    item.box = b;
  }
  return scene;
}

for (const direction of ["TB", "TD", "BT", "LR", "RL"] as const) for (const left of [false, true]) {
  test(`${direction} obstacle on the ${left ? "left" : "right"}: off-center straight entry`, () => {
    const scene = obstructedFixture(direction, left);
    routeGraphLines(scene, direction);
    const points = flat(scene, "e0"), axis = direction === "LR" || direction === "RL" ? "y" : "x";
    const extent = axis === "x" ? "width" : "height";
    assert.equal(points.length - 2, 0, "use the free overlap instead of returning to the target center");
    assert.equal(points[0][axis], points[1][axis]);
    for (const node of scene.nodes) {
      assert.ok(points[0][axis] >= node.box[axis] + 16 && points[0][axis] <= node.box[axis] + node.box[extent] - 16);
    }
    const svg = render(scene, "acme", []), model = { kind: "flow", direction, nodes: {}, edges: [] } as const;
    assertLineQuality(svg, model);
    const quality = visualQuality(svg, model);
    assertVisualLimits(quality);
    assert.equal(quality.edges[0].minimumBends, 0);
  });
}

test("an off-center straight reservation preserves the shared-face port order and spacing", () => {
  const scene = obstructedFixture("TB");
  scene.nodes.push({ ...scene.nodes[0], id: "peer", box: { x: 80, y: 240, width: 72, height: 60 } });
  scene.edges.push({ ...scene.edges[0], id: "peer", target: "peer", sections: [] });
  routeGraphLines(scene, "TB");
  const points = flat(scene, "e0"), peer = flat(scene, "peer");
  assert.equal(points.length - 2, 0);
  assert.equal(peer.length - 2, 0);
  assert.ok(points[0].x - peer[0].x >= 32);
  const svg = render(scene, "acme", []), model = { kind: "flow", direction: "TB", nodes: {}, edges: [] } as const;
  assertLineQuality(svg, model);
  assertVisualLimits(visualQuality(svg, model));
});

for (const width of [168, 180]) for (const direction of ["TB", "BT", "LR", "RL"] as const) test(`${direction} ${width}px off-center straight lanes use the final fanout faces`, () => {
  const scene = emptyScene(), text = textBlock("acme");
  scene.width = 1200; scene.height = 1200;
  const boxes = [
    { x: 450, y: 100, width, height: 100 },
    { x: 85, y: 400, width, height: 100 },
    { x: width === 180 ? 288 : 293, y: 400, width, height: 100 },
    { x: width === 180 ? 615 : 608, y: 470, width, height: 100 },
    { x: 840, y: 400, width, height: 100 },
    { x: 450, y: 900, width, height: 100 },
  ];
  const transform = (box: Box): Box => {
    const b = direction === "LR" || direction === "RL" ? { x: box.y, y: box.x, width: box.height, height: box.width } : { ...box };
    if (direction === "BT") b.y = 1200 - b.y - b.height;
    if (direction === "RL") b.x = 1200 - b.x - b.width;
    return b;
  };
  scene.nodes = boxes.map((box, i) => ({ id: `n${i}`, box: transform(box), text, shape: "box", classes: [], parent: i === 3 ? "area" : "root" }));
  scene.containers = [{ id: "area", box: transform({ x: width === 180 ? 508 : 501, y: 400, width: 299, height: 300 }), text, headerHeight: 28, untrusted: false, classes: [], parent: "root" }];
  scene.edges = boxes.slice(1).map((_, i) => ({ id: `e${i}`, source: "n0", target: `n${i + 1}`, sections: [], dashed: false, head: "filled", labels: [] }));
  routeGraphLines(scene, direction);
  assert.equal(flat(scene, "e4").length - 2, 0, "side-facing L branches must release their unused straight-face slots");
  const model = { kind: "flow", direction, nodes: {}, edges: [] } as const;
  const svg = render(scene, "acme", []);
  assertLineQuality(svg, model);
  assertVisualLimits(visualQuality(svg, model));
});

for (const boundary of [116, 115]) test(`obstacle leaves a lane ${boundary - 100}px from the corner`, () => {
  const scene = obstructedFixture("TB");
  scene.containers[0].box.x = boundary + 12;
  scene.containers[0].box.width = 360 - boundary - 12;
  routeGraphLines(scene, "TB");
  const points = flat(scene, "e0");
  if (boundary === 116) assert.deepEqual(points, [{ x: 116, y: 160 }, { x: 116, y: 400 }]);
  else assert.ok(points.length > 2, "a lane less than 16px from a corner cannot replace the center");
});

test("the bend audit finds off-center straight entries behind a one-sided obstacle zone", () => {
  const svg = (points: string) => '<svg width="800" height="800">'
    + '<g id="node-n0" data-node="100 100 200 60"></g><g id="node-n1" data-node="100 400 200 60"></g>'
    + '<g id="container-obstacle" data-container="180 240 180 100"></g>'
    + `<g id="edge-e0" data-source="n0" data-target="n1"><path data-points="${points}"/></g></svg>`;
  const model = { kind: "flow", direction: "TB", nodes: {}, edges: [] } as const;
  const bent = visualQuality(svg("168,160 168,364 200,364 200,400"), model);
  assert.equal(bent.edges[0].minimumBends, 0, "the minimum is over legal port ranges, not just the chosen target port");
  assert.throws(() => assertVisualLimits(bent), /free straight lane/);
  assertVisualLimits(visualQuality(svg("168,160 168,400"), model));
});

test("a crossed endpoint tab reserves space for the off-center straight entry", () => {
  const scene = obstructedFixture("TB");
  for (const item of [...scene.nodes, ...scene.containers]) item.box.x += 300;
  scene.nodes[1].parent = "target";
  scene.containers.push({ id: "target", box: { x: 340, y: 360, width: 320, height: 160 },
    text: textBlock("acme worker boundary"), headerHeight: 28, untrusted: false, classes: [] });
  routeGraphLines(scene, "TB");
  assert.equal(flat(scene, "e0").length - 2, 0);
  assert.ok(scene.containers[1].box.x < 340, "extend the zone to the left rather than bending around its tab");
  const svg = render(scene, "acme", []), model = { kind: "flow", direction: "TB", nodes: {}, edges: [] } as const;
  assertLineQuality(svg, model);
  assertVisualLimits(visualQuality(svg, model));
});

test("incoming and outgoing edges jointly own the four diamond vertices", () => {
  const scene = fixture("incoming", "TB"), text = textBlock("acme");
  scene.nodes.push(
    { id: "n3", box: { x: 100, y: 600, width: 200, height: 60 }, text, shape: "box", classes: [], parent: "root" },
    { id: "n4", box: { x: -200, y: 600, width: 200, height: 60 }, text, shape: "box", classes: [], parent: "root" });
  scene.edges.push(...["n3", "n4"].map((target, i) => ({ id: `e${i + 2}`, source: "n1", target, main: !i,
    sections: [], dashed: false, head: "filled" as const, labels: [] })));
  routeGraphLines(scene, "TB");
  assert.deepEqual(scene.edges.map((edge) => flat(scene, edge.id).length - 2), [0, 1, 0, 1]);
  const vertices = scene.edges.map((edge) => edge.target === "n1" ? flat(scene, edge.id).at(-1)! : flat(scene, edge.id)[0]);
  assert.equal(new Set(vertices.map((p) => `${p.x},${p.y}`)).size, 4);
});

test("a blocked aligned edge has the proven four-bend obstacle exception", () => {
  const scene = fixture("fanout", "TB");
  scene.edges.pop(); scene.nodes.pop();
  scene.nodes[1].box.y = 500;
  scene.nodes.push({ ...scene.nodes[0], id: "obstacle", box: { x: 84, y: 250, width: 232, height: 60 } });
  routeGraphLines(scene, "TB");
  const quality = visualQuality(render(scene, "acme", []), { kind: "flow", direction: "TB", nodes: {}, edges: [] });
  assertVisualLimits(quality);
  assert.equal(quality.edges[0].bends, 4);
  assert.equal(quality.edges[0].minimumBends, 4);
  assert.match(quality.bendExceptions[0].reason, /obstacle.*Minimum 4/);
});

test("the SVG audit rejects a free straight crank and a needlessly complicated L", () => {
  const svg = (targetX: number, points: string) => '<svg width="800" height="800">'
    + '<g id="node-n0" data-node="100 100 200 60"></g>'
    + `<g id="node-n1" data-node="${targetX} 400 200 60"></g>`
    + `<g id="edge-e0" data-source="n0" data-target="n1"><path data-points="${points}"/></g></svg>`;
  const model = { kind: "flow", direction: "TB", nodes: {}, edges: [] } as const;
  const crank = visualQuality(svg(100, "184,160 184,200 200,200 200,400"), model);
  assert.throws(() => assertVisualLimits(crank), /shared overlap has a free straight lane/);
  const needlesslyBent = visualQuality(svg(400, "200,160 200,200 250,200 250,400 200,400 200,430 400,430"), model);
  assert.throws(() => assertVisualLimits(needlesslyBent), /minimum 1/);
  assertVisualLimits(visualQuality(svg(400, "200,160 200,430 400,430"), model));
});
