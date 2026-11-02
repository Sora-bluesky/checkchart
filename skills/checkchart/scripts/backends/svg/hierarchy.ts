import type { ElkNode, ElkExtendedEdge } from "elkjs/lib/elk-api.js";
import type { Direction } from "../../ir.ts";

// Explicit boundary ports keep cross-zone edges near their endpoint's layer.
// Their labels belong to the common ancestor, outside the crossed zones.
export function hierarchyEdges(root: ElkNode, direction: Direction): Map<string, string[]> {
  const nodes = new Map<string, ElkNode>(), parents = new Map<string, string>();
  const visit = (node: ElkNode) => {
    nodes.set(node.id, node);
    for (const child of node.children ?? []) { parents.set(child.id, node.id); visit(child); }
  };
  visit(root);
  const ancestors = (id: string) => {
    const chain = [id];
    for (let parent = parents.get(id); parent !== undefined; parent = parents.get(parent)) chain.push(parent);
    return chain;
  };
  const entrySide = direction === "LR" ? "WEST" : direction === "RL" ? "EAST" : direction === "BT" ? "SOUTH" : "NORTH";
  const exitSide = direction === "LR" ? "EAST" : direction === "RL" ? "WEST" : direction === "BT" ? "NORTH" : "SOUTH";
  const localSide = (owner: string, incoming: boolean) => {
    const flow = nodes.get(parents.get(owner) ?? "root")?.layoutOptions?.["elk.direction"];
    const sides: Record<string, [string, string]> = { RIGHT: ["WEST", "EAST"], LEFT: ["EAST", "WEST"], DOWN: ["NORTH", "SOUTH"], UP: ["SOUTH", "NORTH"] };
    return sides[flow ?? ""]?.[incoming ? 0 : 1] ?? (incoming ? entrySide : exitSide);
  };
  const port = (owner: string, id: string, side: string) => {
    const node = nodes.get(owner)!;
    node.layoutOptions = { ...node.layoutOptions, "elk.portConstraints": "FIXED_SIDE" };
    (node.ports ??= []).push({ id, width: 0, height: 0, layoutOptions: { "elk.port.side": side } });
    return id;
  };
  const routes = new Map<string, string[]>();
  const edges = root.edges ?? [];
  root.edges = [];
  for (const edge of edges) {
    const source = ancestors(edge.sources[0]), target = ancestors(edge.targets[0]);
    const common = source.slice(1).find((id) => target.slice(1).includes(id))!;
    if (source[1] === common && target[1] === common) {
      (nodes.get(common)!.edges ??= []).push(edge);
      routes.set(edge.id, [edge.id]);
      continue;
    }
    let index = 0;
    const part = (owner: string, from: string, to: string, labels?: ElkExtendedEdge["labels"]) => {
      const id = `${edge.id}-route${index++}`;
      (nodes.get(owner)!.edges ??= []).push({ id, sources: [from], targets: [to], ...(labels ? { labels } : {}) });
      return id;
    };
    const before: string[] = [], after: string[] = [];
    let from = source[0], to = target[0];
    for (let i = 1; source[i] !== common; i++) {
      const boundary = port(source[i], `${edge.id}-out${i}`, localSide(source[i], false));
      before.push(part(source[i], from, boundary));
      from = boundary;
    }
    for (let i = 1; target[i] !== common; i++) {
      const boundary = port(target[i], `${edge.id}-in${i}`, localSide(target[i], true));
      after.unshift(part(target[i], boundary, to));
      to = boundary;
    }
    routes.set(edge.id, [...before, part(common, from, to, edge.labels), ...after]);
  }
  return routes;
}

