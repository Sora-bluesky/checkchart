import fs from "node:fs";
import {
  isPlainObject, messageOf,
  type Architecture, type Component, type Connection, type Direction, type Flow,
  type FlowEdge, type FlowNode, type Model, type Sequence,
  type SequenceItem, type Style, type Zone,
} from "../ir.ts";

const at = (path: string, key: string) => `${path}[${JSON.stringify(key)}]`;
const fail = (path: string, expected: string): never => { throw new Error(`${path} must be ${expected}.`); };

function object(value: unknown, path: string): Record<string, unknown> {
  if (!isPlainObject(value)) return fail(path, "an object");
  return value;
}
function keys(value: Record<string, unknown>, allowed: string[], path: string) {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw new Error(`Unknown key ${JSON.stringify(key)} at ${at(path, key)}.`);
  }
}
function array(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) return fail(path, "an array");
  return value;
}
function id(value: unknown, path: string): string {
  if (typeof value !== "string" || !/^[A-Za-z][A-Za-z0-9_]*$/.test(value)) {
    return fail(path, "an id matching ^[A-Za-z][A-Za-z0-9_]*$");
  }
  return value;
}
function choice<const T extends string>(value: unknown, allowed: readonly T[], path: string, fallback?: T): T {
  if (value === undefined && fallback !== undefined) return fallback;
  for (const option of allowed) if (value === option) return option;
  return fail(path, allowed.map((option) => JSON.stringify(option)).join(" or "));
}
function boolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") return fail(path, "true or false");
  return value;
}
const direction = (value: unknown): Direction => choice(value, ["TB", "TD", "LR", "RL", "BT"], '$["direction"]', "TB");
const style = (value: unknown, path: string): Style => choice(value, ["solid", "dashed"], at(path, "style"), "solid");
const optionalId = (value: unknown, path: string) => value === undefined ? undefined : id(value, path);

function uniqueId(value: unknown, path: string, seen: Map<string, string>): string | undefined {
  const name = optionalId(value, path);
  if (name !== undefined) {
    const previous = seen.get(name);
    if (previous !== undefined) throw new Error(`${path} repeats id ${JSON.stringify(name)} first used at ${previous}.`);
    seen.set(name, path);
  }
  return name;
}

function dictionary<T>(value: unknown, path: string, parse: (value: unknown, path: string) => T): Record<string, T> {
  const fields = object(value, path);
  return Object.fromEntries(Object.entries(fields).map(([name, fact]) => {
    id(name, at(path, name));
    return [name, parse(fact, at(path, name))];
  }));
}

function flow(value: Record<string, unknown>): Flow {
  keys(value, ["kind", "direction", "nodes", "edges"], "$");
  const nodes = dictionary(value.nodes, '$["nodes"]', (raw, path): FlowNode => {
    const fact = object(raw, path);
    keys(fact, ["type"], path);
    return { type: choice(fact.type, ["start", "step", "decision", "store", "end"], at(path, "type"), "step") };
  });
  const ids = new Map<string, string>();
  const edges = array(value.edges, '$["edges"]').map((raw, index): FlowEdge => {
    const path = `$["edges"][${index}]`;
    const fact = object(raw, path);
    keys(fact, ["id", "from", "to", "when", "style"], path);
    const name = uniqueId(fact.id, at(path, "id"), ids);
    const from = id(fact.from, at(path, "from"));
    const to = id(fact.to, at(path, "to"));
    for (const [key, endpoint] of [["from", from], ["to", to]]) {
      if (!Object.hasOwn(nodes, endpoint)) throw new Error(`${at(path, key)} names unknown node ${JSON.stringify(endpoint)}.`);
    }
    const when = optionalId(fact.when, at(path, "when"));
    return { from, to, style: style(fact.style, path), ...(name === undefined ? {} : { id: name }), ...(when === undefined ? {} : { when }) };
  });
  return { kind: "flow", direction: direction(value.direction), nodes, edges };
}

function sequence(value: Record<string, unknown>): Sequence {
  keys(value, ["kind", "participants", "messages"], "$");
  const participants = array(value.participants, '$["participants"]').map((value, index) => id(value, `$["participants"][${index}]`));
  if (new Set(participants).size !== participants.length) throw new Error('$["participants"] contains a duplicate id.');
  const ids = new Set<string>();
  const items = (raw: unknown, path: string): SequenceItem[] => array(raw, path).map((raw, index) => {
    const here = `${path}[${index}]`;
    const fact = object(raw, here);
    if (Object.hasOwn(fact, "par")) {
      keys(fact, ["par", "branches"], here);
      const par = array(fact.par, at(here, "par"));
      if (par.length < 2) fail(at(here, "par"), "an array of at least two branches");
      const branches = fact.branches === undefined ? undefined
        : array(fact.branches, at(here, "branches")).map((raw, index) => id(raw, `${at(here, "branches")}[${index}]`));
      if (branches !== undefined && branches.length !== par.length) fail(at(here, "branches"), `an array of ${par.length} ids, one per branch (got ${branches.length})`);
      return { kind: "parallel", par: par.map((branch, index) => items(branch, `${at(here, "par")}[${index}]`)), ...(branches === undefined ? {} : { branches }) };
    }
    const type = choice(fact.type, ["call", "reply", "signal", "lost", "self", "note"], at(here, "type"));
    const specific = type === "call" ? ["timeout"] : type === "reply" ? ["answers"] : type === "lost" ? ["recovery"] : [];
    keys(fact, ["id", "type", ...(type === "note" ? ["over"] : ["from", "to"]), ...specific], here);
    const name = optionalId(fact.id, at(here, "id"));
    if (name !== undefined) {
      if (ids.has(name)) throw new Error(`${at(here, "id")} repeats message id ${JSON.stringify(name)}.`);
      ids.add(name);
    }
    const base = { kind: "message", ...(name === undefined ? {} : { id: name }) } as const;
    if (type === "note") {
      const over = array(fact.over, at(here, "over")).map((raw, index) => id(raw, `${at(here, "over")}[${index}]`));
      if (over.length < 1 || over.length > 2) fail(at(here, "over"), "one or two participant ids");
      return { ...base, type, over };
    }
    const address = { from: id(fact.from, at(here, "from")), to: id(fact.to, at(here, "to")) };
    switch (type) {
      case "call": return { ...base, ...address, type, ...(fact.timeout === undefined ? {} : { timeout: boolean(fact.timeout, at(here, "timeout")) }) };
      case "reply": return { ...base, ...address, type, ...(fact.answers === undefined ? {} : { answers: id(fact.answers, at(here, "answers")) }) };
      case "lost": return { ...base, ...address, type, ...(fact.recovery === undefined ? {} : { recovery: id(fact.recovery, at(here, "recovery")) }) };
      case "self": case "signal": return { ...base, ...address, type };
    }
  });
  return { kind: "sequence", participants, messages: items(value.messages, '$["messages"]') };
}

function architecture(value: Record<string, unknown>): Architecture {
  keys(value, ["kind", "direction", "zones", "components", "connections"], "$");
  const zones = dictionary(value.zones === undefined ? {} : value.zones, '$["zones"]', (raw, path): Zone => {
    const fact = object(raw, path);
    keys(fact, ["parent", "untrusted"], path);
    const parent = optionalId(fact.parent, at(path, "parent"));
    return { untrusted: fact.untrusted === undefined ? false : boolean(fact.untrusted, at(path, "untrusted")), ...(parent === undefined ? {} : { parent }) };
  });
  const components = dictionary(value.components, '$["components"]', (raw, path): Component => {
    const fact = object(raw, path);
    keys(fact, ["zone", "shape", "level"], path);
    const zone = optionalId(fact.zone, at(path, "zone"));
    const level = fact.level === undefined ? undefined : choice(fact.level, ["context", "container", "component", "code", "deployment"], at(path, "level"));
    return { shape: choice(fact.shape, ["box", "store", "person", "external"], at(path, "shape"), "box"), ...(zone === undefined ? {} : { zone }), ...(level === undefined ? {} : { level }) };
  });
  const ids = new Map<string, string>();
  const connections = array(value.connections, '$["connections"]').map((raw, index): Connection => {
    const path = `$["connections"][${index}]`;
    const fact = object(raw, path);
    keys(fact, ["id", "from", "to", "dir", "style", "checkedBy"], path);
    const name = uniqueId(fact.id, at(path, "id"), ids);
    const checkedBy = optionalId(fact.checkedBy, at(path, "checkedBy"));
    return {
      from: id(fact.from, at(path, "from")), to: id(fact.to, at(path, "to")),
      dir: choice(fact.dir, ["one", "both"], at(path, "dir"), "one"), style: style(fact.style, path),
      ...(name === undefined ? {} : { id: name }),
      ...(checkedBy === undefined ? {} : { checkedBy }),
    };
  });
  return { kind: "architecture", direction: direction(value.direction), zones, components, connections };
}

function freeze(value: unknown) {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return;
  for (const child of Object.values(value)) freeze(child);
  Object.freeze(value);
}

export function parseModel(raw: unknown): Model {
  const value = object(raw, "$");
  const kind = choice(value.kind, ["flow", "sequence", "architecture"], '$["kind"]');
  const model = kind === "flow" ? flow(value) : kind === "sequence" ? sequence(value) : architecture(value);
  freeze(model);
  return model;
}

export function loadModel(file: string): Model {
  let raw: unknown;
  try { raw = JSON.parse(fs.readFileSync(file, "utf8")); }
  catch (error) { throw new Error(`Cannot read model JSON: ${messageOf(error)}`); }
  return parseModel(raw);
}
