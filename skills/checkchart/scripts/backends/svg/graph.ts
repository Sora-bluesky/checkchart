import type { ELK, ElkNode, ElkExtendedEdge } from "elkjs/lib/elk-api.js";
import { keyOf, labelOf, stepOf, type Answers, type Check, type Direction, type Model } from "../../ir.ts";
import { graphPresentation, zoneParents } from "../presentation.ts";
import { mainPath } from "../../passes/flow.ts";
import { emptyScene, type Shape, type SvgNode, type Point } from "./scene.ts";
import { fontSize, headerHeight, textBlock, textWidth, widthBudget } from "./text.ts";
import { hierarchyEdges } from "./hierarchy.ts";
import { routeLayout, routeMetrics } from "./route-layout.ts";
import { layoutHierarchy } from "./layout.ts";
import { edgePairs } from "./line-routing.ts";

type GraphModel = Exclude<Model, { kind: "sequence" }>;
const directions = { TB: "DOWN", TD: "DOWN", BT: "UP", LR: "RIGHT", RL: "LEFT" };
const shapeOf = (form: string): Shape => form === "decision" ? "decision" : form === "store" ? "store"
  : ["start", "end", "person"].includes(form) ? "terminal" : form === "external" ? "external" : "box";

function mainPathPorts(root: ElkNode, main: Set<string>, direction: Direction, decisions: Set<string>) {
  const edges = root.edges ?? [];
  const ids = new Set(edges.filter((edge) => main.has(edge.id)).flatMap((edge) => [...edge.sources, ...edge.targets]));
  const sides = direction === "LR" ? ["WEST", "EAST", "SOUTH"] : direction === "RL" ? ["EAST", "WEST", "SOUTH"]
    : direction === "BT" ? ["SOUTH", "NORTH", "EAST"] : ["NORTH", "SOUTH", "EAST"];
  for (const node of root.children ?? []) {
    if (!ids.has(node.id)) continue;
    // Straight edges alone can use off-center ports. Center the main ports so
    // straightness also aligns the node centers; side branches use another side.
    node.layoutOptions = { ...node.layoutOptions, "elk.portConstraints": "FIXED_POS" };
    const ends = edges.flatMap((edge) => (["sources", "targets"] as const)
      .filter((end) => edge[end][0] === node.id).map((end) => ({ edge, end })));
    const sideEnds = ends.filter(({ edge }) => !main.has(edge.id));
    node.ports = ends.map(({ edge, end }) => {
      const side = main.has(edge.id) ? sides[end === "sources" ? 1 : 0]
        : decisions.has(node.id) && end === "sources" && sideEnds.some((item) => item.end === "targets")
          ? direction === "LR" || direction === "RL" ? "NORTH" : "WEST" : sides[2];
      const index = sideEnds.findIndex((item) => item.edge === edge && item.end === end);
      const fraction = main.has(edge.id) ? 0.5 : (index + 1) / (sideEnds.length + 1);
      const width = node.width ?? 0, height = node.height ?? 0;
      const id = `${node.id}-${edge.id}-${end}`;
      edge[end] = [id];
      return { id, width: 0, height: 0,
        x: side === "WEST" ? 0 : side === "EAST" ? width : width * fraction,
        y: side === "NORTH" ? 0 : side === "SOUTH" ? height : height * fraction,
        layoutOptions: { "elk.port.side": side },
      };
    });
  }
}

export async function graphScene(model: GraphModel, answers: Answers, check: Check, elk: ELK) {
  const natural = await layoutGraph(model, answers, check, elk, false);
  if (natural.width + 48 <= widthBudget) return natural;
  // Keep the reading direction and readable text budgets. Tighter layout may
  // save width only when the finished routes retain their quality.
  let best = natural;
  const nested = model.kind === "architecture" && ["LR", "RL"].includes(model.direction) && Object.values(model.zones).some((zone) => zone.parent !== undefined);
  for (const nestedRows of nested ? [false, true] : [false]) try {
    const compact = await layoutGraph(model, answers, check, elk, true, nestedRows);
    const before = routeMetrics(natural), after = routeMetrics(compact);
    if (compact.width < best.width && compact.containers.every((zone) => zone.text.lines.length <= 2) &&
      after.bends <= before.bends && after.crossings <= before.crossings && after.detour <= before.detour + 1e-6) {
      best = compact;
      if (best.width + 48 <= widthBudget) return best;
    }
  } catch { /* Keep the best routed layout and its width warning if compaction cannot route safely. */ }
  return best;
}

async function layoutGraph(model: GraphModel, answers: Answers, check: Check, elk: ELK, compact: boolean, nestedRows = false) {
  const scene = emptyScene();
  const horizontal = ["LR", "RL"].includes(model.direction);
  const nodeWidth = compact ? 200 : 228;
  const labelWidth = 240;
  const zoneWidth = 320;
  const padding = compact ? 16 : 40;
  const { broken, trail } = graphPresentation(model, answers, check);
  const kind = model.kind === "flow" ? "node" : "component";
  const facts = model.kind === "flow" ? Object.entries(model.nodes).map(([id, fact]) => ({ id, form: fact.type }))
    : Object.entries(model.components).map(([id, fact]) => ({ id, form: fact.shape }));
  const connections = model.kind === "flow" ? model.edges : model.connections;
  const exchanges = new Map<string, typeof connections>();
  for (const edge of connections) if (edge.from !== edge.to) {
    const key = [edge.from, edge.to].sort().join(" ");
    exchanges.set(key, [...exchanges.get(key) ?? [], edge]);
  }
  const laneSpace = new Map<string, number>();
  for (const exchange of exchanges.values()) if (exchange.length >= 3) {
    const extent = Math.max(32, ...exchange.map((edge) => {
      const caption = stepOf(answers, edge);
      if (caption === null) return 32;
      const text = textBlock(caption, 240, fontSize.label);
      return ["LR", "RL"].includes(model.direction) ? text.height + 16 : text.width + 20;
    }));
    for (const id of [exchange[0].from, exchange[0].to]) laneSpace.set(id, Math.max(laneSpace.get(id) ?? 0,
      (connections.filter((edge) => edge.from === id || edge.to === id).length - 1) * extent + 32));
  }
  const sizes = new Map<Shape, { width: number; height: number }>();
  const ids = new Map<string, string>();
  const nodes = new Map<string, SvgNode>();
  for (const [index, { id, form }] of facts.entries()) {
    const shape = shapeOf(form);
    const sizeKind = shape === "external" ? "box" : shape;
    const text = textBlock(labelOf(answers, kind, id), nodeWidth, fontSize.node, "first");
    const width = Math.max(text.width + 32, Math.min(260, Math.max(shape === "decision" ? 160 : 140, text.width * (shape === "decision" ? 2 : 1) + 32)),
      ["LR", "RL"].includes(model.direction) ? 0 : laneSpace.get(id) ?? 0);
    // A centered text rectangle fits a diamond when text.width / width +
    // text.height / height <= 1. Grow the height after using the full width cap.
    // A centered straight port plus one branch needs a full 32px slot on
    // either side, in addition to the existing 32px face padding.
    const faceSpace = Math.max(Math.max(0, connections.filter((edge) => edge.from === id || edge.to === id).length - 1) * 24 + 32,
      connections.filter((edge) => edge.from === id).length > 1 || connections.filter((edge) => edge.to === id).length > 1 ? 32 * 2 + 32 : 0);
    const self = connections.some((edge) => edge.from === id && edge.to === id);
    const selfSpace = self ? (connections.reduce((sum, edge) => sum + Number(edge.from === id) + Number(edge.to === id), 0) - 1) * 60 + 32 : 0;
    const height = shape === "decision" ? Math.max(90, Math.ceil((text.height + 12) / (1 - text.width / width)))
      : Math.max(52, text.height + (shape === "store" ? 40 : 24));
    const previous = sizes.get(sizeKind);
    sizes.set(sizeKind, { width: Math.max(width, previous?.width ?? 0), height: Math.max(height, selfSpace, ["LR", "RL"].includes(model.direction) ? Math.max(faceSpace, laneSpace.get(id) ?? 0) : 0, previous?.height ?? 0) });
    const key = keyOf({ kind, id });
    const group = answers.groups.get(key);
    const color = group === undefined ? undefined : answers.colors.get(group);
    const node: SvgNode = { id: `n${index}`, shape, text, box: { x: 0, y: 0, width, height }, classes: [color ?? "", trail.has(key) ? "bugPath" : "", broken.has(key) ? "breaks" : ""].filter(Boolean) };
    ids.set(id, node.id);
    nodes.set(node.id, node);
  }
  const root: ElkNode = {
    id: "root", children: [], edges: [],
    layoutOptions: {
      "elk.algorithm": "layered", "elk.direction": directions[model.direction],
      "elk.edgeRouting": "ORTHOGONAL", "elk.hierarchyHandling": "SEPARATE_CHILDREN",
      "elk.layered.mergeHierarchyEdges": "false",
      "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES", "elk.randomSeed": "1",
      // More room than the defaults for pills, cylinders and compound headers.
      "elk.spacing.nodeNode": compact && horizontal ? "24" : "40", "elk.layered.spacing.nodeNodeBetweenLayers": compact && horizontal ? "8" : "60",
      "elk.spacing.edgeNode": "20", "elk.layered.spacing.edgeNodeBetweenLayers": "20",
      "elk.spacing.edgeEdge": "24", "elk.spacing.labelNode": "12", "elk.spacing.labelLabel": "12",
      "elk.layered.spacing.edgeEdgeBetweenLayers": "24", "elk.layered.mergeEdges": "false",
      "elk.layered.nodePlacement.strategy": "BRANDES_KOEPF", "elk.layered.nodePlacement.bk.fixedAlignment": "BALANCED",
      "elk.edgeLabels.placement": "CENTER", "elk.edgeLabels.inline": "false",
      "elk.padding": "[top=12,left=12,bottom=12,right=12]",
      "elk.separateConnectedComponents": "false",
    },
  };
  const zones = new Map<string, ElkNode>();
  if (model.kind === "architecture") {
    const parents = zoneParents(model);
    for (const [index, [id, fact]] of Object.entries(model.zones).entries()) {
      const label = labelOf(answers, "zone", id);
      const hardLines = label.split(/\r\n|\r|\n/);
      // Preserve an authored two-line header when the larger Bold face needs
      // a little more width than the former Regular text budget.
      const headerWidth = !compact && hardLines.length === 2 ? Math.max(zoneWidth, ...hardLines.map((line) => Math.ceil(textWidth(line, fontSize.header, 700)))) : zoneWidth;
      const text = textBlock(label, headerWidth, fontSize.header, 700);
      const width = Math.max(140, text.width + (fact.untrusted ? 42 : 24) + 48);
      const bandHeight = headerHeight(text);
      const node: ElkNode = {
        id: `z${index}`, children: [], width, height: bandHeight + 32,
        layoutOptions: {
          ...root.layoutOptions,
          "elk.spacing.nodeNode": compact ? "24" : "40",
          // Stack nested regions while preserving the outer reading direction
          // and the direction of ordinary chains within a leaf region.
          ...(nestedRows && horizontal && [...parents.values()].includes(id) ? { "elk.direction": "DOWN" } : {}),
          "elk.padding": `[top=${bandHeight + padding},left=${padding},bottom=${padding},right=${padding}]`,
        },
      };
      zones.set(id, node);
      scene.containers.push({ id: node.id, box: { x: 0, y: 0, width: 0, height: 0 }, text, headerHeight: bandHeight, untrusted: fact.untrusted, classes: broken.has(keyOf({ kind: "zone", id })) ? ["breaks"] : [] });
    }
    for (const [id, node] of zones) {
      const parent = zones.get(parents.get(id) ?? "") ?? root;
      parent.children?.push(node);
      scene.containers.find((zone) => zone.id === node.id)!.parent = parent.id;
    }
  }
  for (const { id } of facts) {
    const node = nodes.get(ids.get(id) ?? "");
    if (!node) continue;
    const size = sizes.get(node.shape === "external" ? "box" : node.shape);
    // Preserve the port envelope of fanout sources and cross-zone endpoints.
    // Local leaves can use their measured width without spreading a whole row.
    const localLeaf = model.kind === "architecture" && !connections.some((edge) => edge.from === id ||
      edge.to === id && model.components[edge.from].zone !== model.components[id].zone);
    if (size) Object.assign(node.box, compact && localLeaf ? { height: size.height } : size);
    const zone = model.kind === "architecture" ? zones.get(model.components[id].zone ?? "") : undefined;
    (zone ?? root).children?.push({ id: node.id, width: node.box.width, height: node.box.height });
  }
  const main = new Set(model.kind === "flow" ? mainPath(model) : []);
  const mainEdgeIds = new Set<string>();
  for (const [index, edge] of connections.entries()) {
    const from = ids.get(edge.from), to = ids.get(edge.to);
    if (!from || !to) continue;
    const label = stepOf(answers, edge);
    const text = label === null ? undefined : textBlock(label, labelWidth, fontSize.label);
    const id = `e${index}`;
    const layoutEdge: ElkExtendedEdge = { id, sources: [from], targets: [to] };
    if (main.has(edge)) {
      mainEdgeIds.add(id);
      layoutEdge.layoutOptions = { "elk.layered.priority.straightness": "100", "elk.layered.priority.direction": "100" };
    }
    if (text) layoutEdge.labels = [{ id: `${id}-label`, text: text.lines.join("\n"), width: text.width + 12, height: text.height + 8, layoutOptions: { "elk.edgeLabels.placement": "CENTER", "elk.edgeLabels.inline": "false" } }];
    root.edges?.push(layoutEdge);
    scene.edges.push({ id, source: from, target: to,
      main: main.has(edge) || model.kind === "flow" && model.nodes[edge.from]?.type === "decision" && model.edges.find((item) => item.from === edge.from) === edge,
      sections: [], dashed: edge.style === "dashed", head: "filled", both: "dir" in edge && edge.dir === "both",
      broken: check.bugs.some((bug) => bug.rule === "TrustChecked" && bug.evidence.kind === "architecture" && bug.evidence.connection === index),
      labels: text ? [{ id: `${id}-label`, text, box: { x: 0, y: 0, width: text.width + 12, height: text.height + 8 } }] : [],
    });
  }
  // The direction of an exchange is a drawing property, not a reason to put a
  // reciprocal connection on another layer or another face of its endpoints.
  for (const pair of edgePairs(scene.edges)) for (const drawn of pair) {
    const edge = root.edges!.find((edge) => edge.id === drawn.id)!;
    edge.sources = [pair[0].source!]; edge.targets = [pair[0].target!];
    edge.layoutOptions = { ...edge.layoutOptions, "elk.layered.priority.straightness": "1000" };
  }
  if (model.kind === "flow") mainPathPorts(root, mainEdgeIds, model.direction, new Set([...nodes.values()].filter((node) => node.shape === "decision").map((node) => node.id)));
  if (model.kind === "architecture") hierarchyEdges(root, model.direction);
  const layout = model.kind === "architecture" ? await layoutHierarchy(root, elk, scene.containers) : await elk.layout(root);
  const origins = new Map<string, Point>([["root", { x: 0, y: 0 }]]);
  const laidOutEdges: { edge: ElkExtendedEdge; parent: string }[] = [];
  const collect = (parent: ElkNode, offset: Point) => {
    for (const child of parent.children ?? []) {
      const box = { x: offset.x + (child.x ?? 0), y: offset.y + (child.y ?? 0), width: child.width ?? 0, height: child.height ?? 0 };
      origins.set(child.id, box);
      const node = nodes.get(child.id);
      if (node) { node.box = box; node.parent = parent.id; scene.nodes.push(node); }
      const zone = scene.containers.find((zone) => zone.id === child.id);
      if (zone) {
        zone.box = box;
      }
      collect(child, box);
    }
    for (const edge of parent.edges ?? []) laidOutEdges.push({ edge, parent: parent.id });
  };
  collect(layout, { x: 0, y: 0 });
  const pills = new Map(scene.edges.flatMap((edge) => edge.labels).map((pill) => [pill.id, pill]));
  for (const { edge, parent } of laidOutEdges) {
    // Label reservations use the common ancestor's coordinate system.
    const offset = origins.get(edge.container ?? parent) ?? { x: 0, y: 0 };
    for (const label of edge.labels ?? []) {
      const pill = pills.get(label.id ?? "");
      if (pill) { pill.box.x = offset.x + (label.x ?? 0); pill.box.y = offset.y + (label.y ?? 0); }
    }
  }
  scene.width = Math.max(1, layout.width ?? 0);
  scene.height = Math.max(1, layout.height ?? 0);
  return routeLayout(scene, model.direction);
}
