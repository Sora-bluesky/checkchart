import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import ELK from "elkjs/lib/elk.bundled.js";
import { loadModel, parseModel } from "../frontends/model.ts";
import { answersOf, checkView, loadView } from "../frontends/view.ts";
import { graphScene } from "../backends/svg/graph.ts";
import { sequenceScene } from "../backends/svg/sequence.ts";
import { render } from "../backends/svg/render.ts";
import { textWidth, wrapText } from "../backends/svg/text.ts";
import { overlaps, tabBox } from "../backends/svg/scene.ts";
import { assertLayoutQuality } from "./svg-geometry.ts";
import { root, run, scratch } from "./helpers.ts";
import { assertLabelAffinity, assertSvgMinimumJog, assertVisualBaseline, assertVisualLimits, assertVisualText, assertVisualWidth, labelDistance, measureChart, visualCorpus, visualQuality, type VisualMetrics } from "./visual-quality.ts";

const baselineFile = new URL("./visual-quality-baseline.json", import.meta.url);
test("visual audit rejects jogs under 16px even across fallback sections", () => {
  const svg = (jog: number) => `<svg width="300" height="300"><g id="edge-e0"><path data-points="0,0 0,24 8,24"/><path data-points="8,24 ${jog},24 ${jog},100"/></g></svg>`;
  assertSvgMinimumJog(svg(16));
  assert.throws(() => assertSvgMinimumJog(svg(15.96)), /jog under 16px/);
  assert.throws(() => visualQuality(svg(15.96), { kind: "flow", direction: "TB", nodes: {}, edges: [] }), /jog under 16px/);
});
test("visual baseline covers exactly the four examples and every public fixture", () => {
  const baseline = JSON.parse(fs.readFileSync(baselineFile, "utf8"));
  assert.equal(baseline.version, 1);
  assert.deepEqual(Object.keys(baseline.charts).sort(), visualCorpus().map(({ id }) => id).sort());
  assert.deepEqual(visualCorpus().filter(({ id }) => id.startsWith("examples/")).map(({ id }) => id).sort(), ["examples/architecture", "examples/flow", "examples/sequence", "examples/warnings"]);
});
for (const { id, file } of visualCorpus()) test(`visual quality baseline: ${id}`, async (t) => {
  const quality = await measureChart(file, path.join(scratch(t), "out"));
  const baseline = JSON.parse(fs.readFileSync(baselineFile, "utf8"));
  if (id.startsWith("examples/") && !baseline.wideExamples?.[id]) assertVisualWidth(quality);
  assertVisualLimits(quality);
  assert.ok(baseline.charts[id], `missing visual baseline: ${id}`);
  assertVisualBaseline(quality.metrics, baseline.charts[id]);
});

const parentRouteLimits = { archA: { bends: 4, detour: 1 }, archB: { bends: 3, detour: 1 }, flow: { bends: 3, detour: 1 }, seq: { bends: 6, detour: 1.8 } };
if (process.env.CHECKCHART_PARENT_CHARTS) for (const name of ["archA", "archB", "flow", "seq"] as const) {
  test(`parent chart visual quality: ${name}`, async () => {
    fs.mkdirSync(path.join(root, ".tmp"), { recursive: true });
    const dir = fs.mkdtempSync(path.join(root, ".tmp", `${name}-quality-`));
    const quality = await measureChart(path.join(process.env.CHECKCHART_PARENT_CHARTS!, name, "model.json"), path.join(dir, "out"));
    fs.writeFileSync(path.join(dir, "quality.json"), JSON.stringify(quality, null, 2) + "\n", "utf8");
    assertVisualWidth(quality);
    assert.equal(quality.metrics.crossings, 0, `${name} crossings`);
    assert.ok(quality.metrics.totalBends <= parentRouteLimits[name].bends, `${name} bends`);
    assert.ok(quality.metrics.maxDetourRatio <= parentRouteLimits[name].detour + 1e-6, `${name} detour`);
    assertVisualLimits(quality);
  });
}

test("the hard width limit includes 1100px and rejects any excess", () => {
  const model = { kind: "flow", direction: "TB", nodes: {}, edges: [] } as const;
  assertVisualWidth(visualQuality('<svg width="1100" height="100"></svg>', model));
  assert.throws(() => assertVisualWidth(visualQuality('<svg width="1100.01" height="100"></svg>', model)), /width.*1100/);
});

test("visual baseline rejects worsened counts or detours and measurements beyond 5%", () => {
  const metrics: VisualMetrics = { totalBends: 100, totalEdgeLength: 100, crossings: 100, maxLabelDistance: 4, meanLabelDistance: 4,
    maxDetourRatio: 1, maxTabLines: 1, totalTabLines: 100, sameFaceCrossings: 0, labelAffinityViolations: 0, width: 100, height: 100 };
  assert.throws(() => assertVisualBaseline({ ...metrics, maxDetourRatio: 1.001 }, metrics), /maxDetourRatio/);
  for (const key of ["totalBends", "crossings", "maxDetourRatio", "maxTabLines", "totalTabLines", "sameFaceCrossings", "labelAffinityViolations"] as const) {
    assert.throws(() => assertVisualBaseline({ ...metrics, [key]: metrics[key] + 1 }, metrics), new RegExp(key));
  }
  for (const key of ["totalEdgeLength", "maxLabelDistance", "meanLabelDistance", "width", "height"] as const) {
    assertVisualBaseline({ ...metrics, [key]: metrics[key] * 1.05 }, metrics);
    assert.throws(() => assertVisualBaseline({ ...metrics, [key]: metrics[key] * 1.051 }, metrics), new RegExp(key));
  }
});

test("visual audit measures section joins, box distances and crossings on the whole face", () => {
  const svg = '<svg width="300" height="300"><g id="edge-e0" data-source="n0" data-target="n1">'
    + '<path data-points="50,0 50,100"/><path data-points="50,100 50,200 0,200"/></g>'
    + '<g id="edge-e1" data-source="n0" data-target="n2"><path data-points="75,0 75,150 0,150"/></g>'
    + '<g id="label-e0-label" data-pill="26 40 20 20"></g></svg>';
  const quality = visualQuality(svg, { kind: "flow", direction: "TB", nodes: {}, edges: [] });
  assert.equal(quality.metrics.totalBends, 2);
  assert.equal(quality.metrics.totalEdgeLength, 475);
  assert.equal(quality.metrics.maxLabelDistance, 4);
  assert.equal(quality.metrics.crossings, 1);
  assert.deepEqual(quality.sameFacePairs, ["e0 / e1"]);
  assert.throws(() => assertVisualLimits(quality), /same face cross/);
  const far = visualQuality(svg.replace('26 40 20 20', '120 40 20 20'), { kind: "flow", direction: "TB", nodes: {}, edges: [] });
  assert.throws(() => assertVisualLimits(far), /label distance/);
});

const check = { rules: [], bugs: [], unchecked: [] };
const purpose = { title: "acme", reader: "A maintainer", question: "How does acme work?" };
test("acme Webhook text stays 4-8px from its own horizontal segment outside both zones", async (t) => {
  const dir = path.join(import.meta.dirname, "fixtures", "rendering");
  const file = path.join(dir, "acme-order-lr.json"), out = path.join(scratch(t), "out");
  const result = run(file, out, path.join(dir, "acme-order-lr.mjs"), ["--svg"]);
  assert.equal(result.status, 1, result.stderr || result.report);
  assert.match(result.report, /TrustChecked breaks/);
  const svg = fs.readFileSync(path.join(out, "chart.svg"), "utf8"), model = loadModel(file);
  const quality = visualQuality(svg, model);
  assertVisualLimits(quality);
  assertLayoutQuality(svg, model);
  const label = svg.match(/<g id="label-e4-label"[^>]*>(.*?)<\/g>/)![1];
  assert.match(label, /支払い結果を通知する（Webhook）/);
  const [x, , width] = label.match(/data-text="([^"]+)"/)![1].split(" ").map(Number);
  const lines = [...label.matchAll(/<tspan\b[^>]* y="([^"]+)" font-size="([^"]+)"/g)]
    .map((m) => ({ top: Number(m[1]) - Number(m[2]), height: Number(m[2]) }));
  const top = Math.min(...lines.map((line) => line.top));
  const drawn = { x, y: top, width, height: Math.max(...lines.map((line) => line.top + line.height)) - top };
  const own = svg.match(/<g id="edge-e4"[^>]*>(.*?)<\/g>/)![1];
  const horizontal = [...own.matchAll(/data-points="([^"]+)"/g)].flatMap((section) => {
    const points = section[1].split(" ").map((point) => {
      const [x, y] = point.split(",").map(Number);
      return { x, y };
    });
    return points.slice(1).map((b, i) => ({ a: points[i], b })).filter(({ a, b }) => a.y === b.y);
  });
  const gap = Math.min(...horizontal.map((segment) => labelDistance(drawn, segment)));
  assert.ok(gap >= 4 - 0.03 && gap <= 8 + 0.03, `Webhook text is ${gap}px from its own line`);
  for (const zone of svg.matchAll(/data-container="([^"]+)"/g)) {
    const [x, y, width, height] = zone[1].split(" ").map(Number);
    assert.ok(!overlaps(drawn, { x, y, width, height }), "Webhook text stays outside foreign zones");
  }
});
for (const name of ["acme-order-tb", "label-affinity"]) test(`fallback labels stay closest to their own finished route: ${name}`, async () => {
  const dir = path.join(import.meta.dirname, "fixtures", "rendering");
  const model = loadModel(path.join(dir, `${name}.json`));
  assert.equal(model.kind, "architecture");
  if (model.kind !== "architecture") return;
  const scene = await graphScene(model, answersOf(model, await loadView(path.join(dir, `${name}.mjs`))), check, new ELK());
  const segments = (edge: typeof scene.edges[number]) => edge.sections.flatMap((section) => section.slice(1).map((b, i) => ({ a: section[i], b })));
  for (const edge of scene.edges) for (const label of edge.labels) {
    const distance = Math.min(...segments(edge).map((segment) => labelDistance(label.box, segment)));
    const other = Math.min(...scene.edges.filter((other) => other !== edge).flatMap((edge) => segments(edge).map((segment) => labelDistance(label.box, segment))));
    assertLabelAffinity({ labels: [{ edge: edge.id, distance, other }] });
  }
  assertLabelAffinity(visualQuality(render(scene, purpose.title, []), model));
});
test("visual text audit rejects word cuts, premature wrapping and glyph compression", async () => {
  const model = parseModel({ kind: "architecture", zones: { area: {} }, components: { a: { zone: "area" }, b: { zone: "area" } }, connections: [{ from: "a", to: "b" }] });
  if (model.kind !== "architecture") return;
  const answers = answersOf(model, checkView({ ...purpose, label: { area: "画面側：core の Job の外", a: "保存の担当を引き継ぐ", b: "日本\n語" }, step: () => "無ければ起動・あれば接続" }));
  const svg = render(await graphScene(model, answers, check, new ELK()), purpose.title, []);
  assertVisualText(svg, model, answers);
  for (const [source, replacement, error] of [
    ["保存の担当を引き継ぐ", "保存の担</tspan><tspan>当を引き継ぐ", /word break/],
    ["無ければ起動・あれば接続", "無ければ起動・</tspan><tspan>あれば接続", /240px/],
    ["画面側：core の Job の外", "画面側：core</tspan><tspan>の Job の外", /320px/],
  ] as const) {
    assert.ok(svg.includes(source));
    assert.throws(() => assertVisualText(svg.replace(source, replacement), model, answers), error);
  }
  assert.throws(() => assertVisualText(svg.replace('font-weight="700">保存の担当を引き継ぐ', 'font-weight="700" textLength="40">保存の担当を引き継ぐ'), model, answers), /shrinks text/);
});
test("wide layouts keep every tab on one line when it fits 320px", async () => {
  const captions = ["画面側：core の Job の外", "core Job：閉じると中が全部終わる", "ペイン Job：端末ごと", "新版の core Job：更新中だけ"];
  const model = parseModel({ kind: "architecture", direction: "TB",
    zones: Object.fromEntries(captions.map((_, i) => [`area${i}`, {}])),
    components: Object.fromEntries(captions.map((_, i) => [`worker${i}`, { zone: `area${i}` }])), connections: [] });
  if (model.kind !== "architecture") return;
  const answers = answersOf(model, checkView({ ...purpose, label: Object.fromEntries(captions.map((text, i) => [`area${i}`, text])) }));
  const scene = await graphScene(model, answers, check, new ELK());
  for (const [i, zone] of scene.containers.entries()) {
    assert.ok(textWidth(captions[i], 15, 700) <= 320);
    assert.deepEqual(zone.text.lines, [captions[i]]);
    assert.ok(zone.box.width >= tabBox(zone).width + 48);
  }
});
for (const direction of ["TB", "LR", "RL"] as const) test(`${direction} cross-zone label stays in the gap beyond its source's sibling`, async () => {
  const dir = path.join(import.meta.dirname, "fixtures", "architecture-label-gap");
  const model = loadModel(path.join(dir, "model.json"));
  assert.equal(model.kind, "architecture");
  const scene = await graphScene({ ...model, direction }, answersOf(model, await loadView(path.join(dir, "view.mjs"))), check, new ELK());
  const edge = scene.edges.find((edge) => edge.id === "e4")!, label = edge.labels[0];
  if (direction === "TB") {
    const source = scene.nodes.find((node) => node.id === edge.source)!, sibling = scene.nodes.find((node) => node.id === "n3")!;
    assert.ok(source.box.y + source.box.height < sibling.box.y, "the unrelated sibling is below the source");
    assert.ok(scene.containers[0].box.y + scene.containers[0].box.height < scene.containers[1].box.y, "the target zone is further below");
  }
  for (const zone of scene.containers) assert.ok(!overlaps(label.box, zone.box), `label overlaps ${zone.id}`);
  const quality = visualQuality(render(scene, purpose.title, []), { ...model, direction });
  assertVisualLimits(quality);
  assert.ok(quality.labels.find((label) => label.edge === edge.id)!.nodeClearance! >= 16 - 0.03);
});

test("visual audit rejects labels within 16px of an unrelated node", () => {
  const model = parseModel({ kind: "flow", nodes: { a: {}, b: {}, c: {} }, edges: [{ from: "a", to: "b" }] });
  const svg = (nodeX: number) => '<svg width="300" height="300"><g id="edge-e0" data-source="n0" data-target="n1"><path data-points="50,0 50,200"/></g>'
    + '<g id="label-e0-label" data-pill="54 50 60 20"></g>'
    + `<g id="node-n2" data-node="${nodeX} 50 60 40"></g></svg>`;
  assert.throws(() => assertVisualLimits(visualQuality(svg(129), model)), /16px from an unrelated node/);
  assertVisualLimits(visualQuality(svg(130), model));
  assertVisualLimits(visualQuality(svg(115).replace('node-n2', 'node-n0'), model));
});
for (const caption of ["信頼しない入出力", "画面を閉じても端末は残る", "acme processing coordination boundary", "acme processing and request coordination boundary"]) {
  test(`tab uses the 320px text budget and grows its zone: ${caption}`, async () => {
    const model = parseModel({ kind: "architecture", direction: "LR", zones: { area: { untrusted: true } }, components: { a: { zone: "area" } }, connections: [] });
    if (model.kind !== "architecture") return;
    const answers = answersOf(model, checkView({ ...purpose, label: { area: caption, a: "acme" } }));
    const scene = await graphScene(model, answers, check, new ELK()), zone = scene.containers[0];
    assert.deepEqual(zone.text.lines, wrapText(caption, 320, 15, 700));
    if (textWidth(caption, 15, 700) <= 320) assert.deepEqual(zone.text.lines, [caption]);
    else assert.equal(zone.text.lines.length, 2);
    assert.ok(zone.box.width >= tabBox(zone).width + 48);
    assertLayoutQuality(render(scene, purpose.title, []), model);
  });
}

test("cross-zone exits keep a minimum-bend facing route without turns at zone borders", async () => {
  fs.mkdirSync(path.join(root, ".tmp"), { recursive: true });
  const dir = path.join(import.meta.dirname, "fixtures", "architecture-layout-tb");
  const out = path.join(fs.mkdtempSync(path.join(root, ".tmp", "exit-quality-")), "out");
  const quality = await measureChart(path.join(dir, "model.json"), out);
  assertVisualLimits(quality);
  // This fixture includes both nested exits and an external observer; the full
  // quality proof also covers the source-face fanout and every label.
  assert.ok(quality.edges.find((edge) => edge.id === "e3")!.detour <= 1.3);
  const svg = fs.readFileSync(path.join(out, "chart.svg"), "utf8");
  const first = svg.match(/<g id="edge-e3"[^>]*>.*?data-points="([^"]+)"/)![1].split(" ").map((point) => point.split(",").map(Number));
  assert.equal(quality.edges.find((edge) => edge.id === "e3")!.bends, 1, "a free facing L must stay an L across the zone borders");
  assert.ok(first[1][0] > first[0][0], "leave the target-facing side before turning past its sibling");
  assertLayoutQuality(svg, loadModel(path.join(dir, "model.json")));
});

test("hard limits reject distant labels, misleading ownership, excessive detours and three-line tabs", () => {
  const model = { kind: "flow", direction: "TB", nodes: {}, edges: [] } as const;
  const wrap = (body: string) => `<svg width="300" height="300">${body}</svg>`;
  const edge = (id: string, points: string) => `<g id="edge-${id}"><path data-points="${points}"/></g>`;
  const shorter = visualQuality(wrap(edge("e0", "0,0 0,200 50,200 50,225 150,225") + '<g id="label-e0-label" data-pill="54 208 8 10"></g>'), model);
  assertVisualLimits(shorter);
  const distant = visualQuality(wrap(edge("e0", "50,0 50,200") + '<g id="label-e0-label" data-pill="70 40 20 20"></g>'), model);
  assert.throws(() => assertVisualLimits(distant), /label distance/);
  const misleading = visualQuality(wrap(edge("e0", "50,0 50,200") + edge("e1", "75,0 75,200") + '<g id="label-e0-label" data-pill="54 40 20 20"></g>'), model);
  assert.equal(misleading.metrics.maxLabelDistance, 4);
  assert.throws(() => assertVisualLimits(misleading), /not closest to its own edge/);
  assert.throws(() => assertVisualLimits(visualQuality(wrap(edge("e0", "0,0 0,100 100,100 100,0")), model)), /detour/);
  assert.throws(() => assertVisualLimits(visualQuality(wrap('<g id="container-z0"><text><tspan /><tspan /><tspan /></text></g>'), model)), /3 lines/);
});

for (const kind of ["architecture", "sequence"] as const) test(`${kind} self routes meet the detour limit without exempting loops`, async () => {
  const model = parseModel(kind === "sequence" ? { kind, participants: ["a"], messages: [{ from: "a", to: "a", type: "self" }] }
    : { kind, components: { a: {} }, connections: [{ from: "a", to: "a" }] });
  const answers = answersOf(model, checkView({ ...purpose, step: () => "Updates acme" }));
  const scene = model.kind === "sequence" ? sequenceScene(model, answers, check) : await graphScene(model, answers, check, new ELK());
  assertVisualLimits(visualQuality(render(scene, purpose.title, []), model));
});
