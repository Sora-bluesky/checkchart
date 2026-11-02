import { type Bug, type Check, type Flow, type FlowEdge } from "../ir.ts";

export const FLOW_RULES = ["HasStartAndEnd", "Reachable", "HasExit", "ReachesEnd", "DecisionBranches", "EndIsFinal"];

// A decision's first modeled edge states the main branch; condition ids have no semantics.
export function mainPath(model: Flow): FlowEdge[] {
  const outgoing = new Map(Object.keys(model.nodes).map((id) => [id, model.edges.filter((edge) => edge.from === id)]));
  let longest: FlowEdge[] = [];
  const seen = new Set<string>();
  const path: FlowEdge[] = [];
  const visit = (id: string) => {
    if (seen.has(id) || model.nodes[id].type === "store") return;
    if (model.nodes[id].type === "end") {
      if (path.length > longest.length) longest = [...path];
      return;
    }
    seen.add(id);
    const edges = outgoing.get(id) ?? [];
    for (const edge of model.nodes[id].type === "decision" ? edges.slice(0, 1) : edges) {
      path.push(edge);
      visit(edge.to);
      path.pop();
    }
    seen.delete(id);
  };
  for (const [id, node] of Object.entries(model.nodes)) if (node.type === "start") visit(id);
  return longest;
}

export function flowRoutes(model: Flow) {
  const ids = Object.keys(model.nodes);
  const starts = ids.filter((id) => model.nodes[id].type === "start");
  const outgoing = new Map(ids.map((id) => [id, model.edges.filter((edge) => edge.from === id)]));
  const routes = new Map<string, { start: string; path: FlowEdge[] }>();
  const queue = [...starts];
  for (const start of starts) routes.set(start, { start, path: [] });
  for (let index = 0; index < queue.length; index++) {
    const from = queue[index];
    const route = routes.get(from);
    if (!route) continue;
    for (const edge of outgoing.get(from) ?? []) if (!routes.has(edge.to)) {
      routes.set(edge.to, { start: route.start, path: [...route.path, edge] });
      queue.push(edge.to);
    }
  }
  return routes;
}

export function checkFlow(model: Flow): Check {
  const ids = Object.keys(model.nodes);
  const starts = ids.filter((id) => model.nodes[id].type === "start");
  const ends = ids.filter((id) => model.nodes[id].type === "end");
  const outgoing = new Map(ids.map((id) => [id, model.edges.filter((edge) => edge.from === id)]));
  const routes = flowRoutes(model);

  // A store is a side target. Passing through it cannot finish the flow.
  const backwards = new Map(ids.map((id) => [id, [] as string[]]));
  for (const edge of model.edges) {
    if (model.nodes[edge.to].type !== "store" && model.nodes[edge.from].type !== "store") {
      backwards.get(edge.to)?.push(edge.from);
    }
  }
  const finishes = new Set(ends);
  const reverse = [...ends];
  for (let index = 0; index < reverse.length; index++) {
    for (const from of backwards.get(reverse[index]) ?? []) if (!finishes.has(from)) {
      finishes.add(from);
      reverse.push(from);
    }
  }

  function cycleAt(node: string): string[] | undefined {
    const paths = new Map<string, string[]>([[node, [node]]]);
    const queue = [node];
    for (let index = 0; index < queue.length; index++) {
      const from = queue[index];
      for (const edge of outgoing.get(from) ?? []) {
        if (model.nodes[edge.to].type === "store") continue;
        const path = paths.get(from) ?? [];
        if (edge.to === node) return path;
        if (!paths.has(edge.to)) {
          paths.set(edge.to, [...path, edge.to]);
          queue.push(edge.to);
        }
      }
    }
    return undefined;
  }

  const bugs: Bug[] = [];
  const add = (rule: string, node: string) => bugs.push({
    rule, marks: [{ kind: "node", id: node }],
    evidence: { kind: "flow", node, ...routes.get(node), ...(rule === "ReachesEnd" ? { cycle: cycleAt(node) } : {}) },
  });
  if (!starts.length || !ends.length) bugs.push({
    rule: "HasStartAndEnd", marks: ids.map((id) => ({ kind: "node", id })), evidence: { kind: "flow" },
  });
  for (const id of ids) {
    const node = model.nodes[id];
    const edges = outgoing.get(id) ?? [];
    if (!routes.has(id)) add("Reachable", id);
    if (node.type !== "end" && node.type !== "store" && !edges.some((edge) => model.nodes[edge.to].type !== "store")) add("HasExit", id);
    if (node.type !== "store" && !finishes.has(id)) add("ReachesEnd", id);
    if (node.type === "decision" && (edges.length < 2 || edges.some((edge) => edge.when === undefined) || new Set(edges.map((edge) => edge.when)).size !== edges.length)) add("DecisionBranches", id);
    if (node.type === "end" && edges.some((edge) => model.nodes[edge.to].type !== "store")) add("EndIsFinal", id);
  }
  return { rules: FLOW_RULES, bugs, unchecked: [] };
}
