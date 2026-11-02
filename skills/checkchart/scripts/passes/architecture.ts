import { byText, untrustedZonesOf, type Architecture, type Bug, type Check, type Ref } from "../ir.ts";

export const ARCHITECTURE_RULES = ["EndsDeclared", "TrustChecked", "Connected"];

export function checkArchitecture(model: Architecture): Check {
  const bugs: Bug[] = [];
  const cycles = new Set<string>();
  for (const [id, zone] of Object.entries(model.zones)) {
    if (zone.parent !== undefined && !Object.hasOwn(model.zones, zone.parent)) bugs.push({
      rule: "EndsDeclared", marks: [{ kind: "zone", id }],
      evidence: { kind: "architecture", zone: id, detail: "Its parent zone is not declared." },
    });
    const chain: string[] = [];
    let next: string | undefined = id;
    while (next !== undefined && Object.hasOwn(model.zones, next) && !chain.includes(next)) {
      chain.push(next);
      next = model.zones[next].parent;
    }
    if (next !== undefined && chain.includes(next)) {
      const cycle = chain.slice(chain.indexOf(next));
      const key = [...cycle].sort(byText).join(",");
      if (!cycles.has(key)) bugs.push({
        rule: "EndsDeclared", marks: cycle.map((id) => ({ kind: "zone", id })),
        evidence: { kind: "architecture", zone: cycle[0], detail: "Its parent zones form a cycle." },
      });
      cycles.add(key);
    }
  }
  for (const [id, component] of Object.entries(model.components)) if (component.zone !== undefined && !Object.hasOwn(model.zones, component.zone)) bugs.push({
    rule: "EndsDeclared", marks: [{ kind: "component", id }],
    evidence: { kind: "architecture", component: id, detail: "Its zone is not declared." },
  });
  const used = new Set<string>();
  let unknownTrust = false;
  for (const [index, connection] of model.connections.entries()) {
    const endpoints = [...new Set([connection.from, connection.to])];
    const known = endpoints.filter((id) => Object.hasOwn(model.components, id));
    for (const id of known) used.add(id);
    const marks: Ref[] = known.map((id) => ({ kind: "component", id }));
    if (known.length !== endpoints.length) bugs.push({
      rule: "EndsDeclared", marks,
      evidence: { kind: "architecture", connection: index, detail: "One or both ends of this connection are not declared components." },
    });
    const from = untrustedZonesOf(model, connection.from);
    const to = untrustedZonesOf(model, connection.to);
    if (!from || !to) { unknownTrust = true; continue; }
    const untrusted = from.length && !to.length ? { from: connection.from, to: connection.to, zones: from }
      : connection.dir === "both" && to.length && !from.length ? { from: connection.to, to: connection.from, zones: to }
      : undefined;
    if (untrusted && connection.checkedBy !== untrusted.to) bugs.push({
      rule: "TrustChecked", marks,
      evidence: { kind: "architecture", connection: index, untrusted, detail: "The trusted receiver must check what it receives from untrusted content." },
    });
  }
  for (const id of Object.keys(model.components)) if (!used.has(id)) bugs.push({
    rule: "Connected", marks: [{ kind: "component", id }],
    evidence: { kind: "architecture", component: id, detail: "This component takes part in no connection." },
  });
  return {
    rules: ARCHITECTURE_RULES, bugs,
    unchecked: unknownTrust ? ["TrustChecked for connections with undeclared ends or invalid zone ancestry"] : [],
  };
}
