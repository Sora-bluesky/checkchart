export const COLORS = {
  blue: "#c3e0ff",
  orange: "#f0d3bf",
  purple: "#e3d5ff",
  yellow: "#f0dcbf",
  teal: "#bfe3df",
  tan: "#e5d9ce",
  pink: "#ffcbe6",
} as const;

export type Color = keyof typeof COLORS;
export type Direction = "TB" | "TD" | "LR" | "RL" | "BT";
export type Style = "solid" | "dashed";
export type FlowNode = { type: "start" | "step" | "decision" | "store" | "end" };
export type FlowEdge = { id?: string; from: string; to: string; when?: string; style: Style };
export type Flow = {
  kind: "flow";
  direction: Direction;
  nodes: Record<string, FlowNode>;
  edges: FlowEdge[];
};

type MessageBase = { kind: "message"; id?: string };
type Address = { from: string; to: string };
export type Message = MessageBase & (
  | (Address & { type: "call"; timeout?: boolean })
  | (Address & { type: "reply"; answers?: string })
  | (Address & { type: "signal" | "self" })
  | (Address & { type: "lost"; recovery?: string })
  | { type: "note"; over: string[] }
);
export type Parallel = { kind: "parallel"; par: SequenceItem[][]; branches?: string[] };
export type SequenceItem = Message | Parallel;
export type Sequence = { kind: "sequence"; participants: string[]; messages: SequenceItem[] };

export type Zone = { parent?: string; untrusted: boolean };
export type Level = "context" | "container" | "component" | "code" | "deployment";
export type Component = { zone?: string; shape: "box" | "store" | "person" | "external"; level?: Level };
export type Connection = {
  id?: string;
  from: string;
  to: string;
  dir: "one" | "both";
  style: Style;
  checkedBy?: string;
};
export type Architecture = {
  kind: "architecture";
  direction: Direction;
  zones: Record<string, Zone>;
  components: Record<string, Component>;
  connections: Connection[];
};
export type Model = Flow | Sequence | Architecture;
export type ElementKind = "node" | "participant" | "component" | "zone" | "branch";
export type Ref = { kind: ElementKind; id: string };
export type Element = Ref & (
  | { kind: Exclude<ElementKind, "branch">; fact: FlowNode | Component | Zone | string }
  | { kind: "branch"; fact: SequenceItem[] }
);
export type Arrow = FlowEdge | Message | Connection;

export type Locale = "en" | "ja";

export type Answers = {
  locale?: Locale;
  title?: string;
  reader?: string;
  question?: string;
  product?: string;
  colors: Map<string, Color>;
  labels: Map<string, string>;
  branchLabels: Map<SequenceItem[], string>;
  groups: Map<string, string>;
  steps: Map<Arrow, string | null>;
};

export type Evidence =
  | { kind: "purpose"; missing: string[] }
  | { kind: "flow"; node?: string; start?: string; path?: FlowEdge[]; cycle?: string[] }
  | { kind: "sequence"; index?: number; involved: string[]; detail: string; participant?: string }
  | {
      kind: "architecture";
      connection?: number;
      component?: string;
      zone?: string;
      detail: string;
      untrusted?: { from: string; to: string; zones: string[] };
    }
  | { kind: "product"; element: string; text: string; ref?: Ref; arrow?: Arrow };
export type Bug = { rule: string; marks: Ref[]; evidence: Evidence };
export type Warning = { rule: string; detail: string };
export type Check = { rules: string[]; bugs: Bug[]; unchecked: string[]; warnings?: Warning[] };

export const keyOf = ({ kind, id }: Ref) => `${kind}:${id}`;
export const labelOf = (answers: Answers, kind: ElementKind, id: string) =>
  answers.labels.get(keyOf({ kind, id })) ?? id;
export const stepOf = (answers: Answers, arrow: Arrow) => answers.steps.get(arrow) ?? null;
export const byText = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
export const list = (items: string[], and = "and") => items.length < 2
  ? items.join("")
  : `${items.slice(0, -1).join(", ")} ${and} ${items.at(-1)}`;
export const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (typeof value !== "object" || value === null) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};
export const messageOf = (error: unknown) => error instanceof Error ? error.message : String(error);

export function messagesOf(items: SequenceItem[]): Message[] {
  const messages: Message[] = [];
  for (const item of items) {
    if (item.kind === "parallel") for (const branch of item.par) messages.push(...messagesOf(branch));
    else messages.push(item);
  }
  return messages;
}

export const participantsOf = (message: Message) =>
  message.type === "note" ? message.over : [message.from, message.to];

export function elementsOf(model: Model): Element[] {
  switch (model.kind) {
    case "flow": return Object.entries(model.nodes).map(([id, fact]) => ({ id, kind: "node", fact }));
    case "sequence": {
      const branches: Element[] = [];
      const visit = (items: SequenceItem[]) => {
        for (const item of items) if (item.kind === "parallel") {
          for (const [index, fact] of item.par.entries()) {
            const id = item.branches?.[index];
            if (id !== undefined) branches.push({ id, kind: "branch", fact });
            visit(fact);
          }
        }
      };
      visit(model.messages);
      return [...model.participants.map((id): Element => ({ id, kind: "participant", fact: id })), ...branches];
    }
    case "architecture": return [
      ...Object.entries(model.zones).map(([id, fact]): Element => ({ id, kind: "zone", fact })),
      ...Object.entries(model.components).map(([id, fact]): Element => ({ id, kind: "component", fact })),
    ];
  }
}

export const arrowsOf = (model: Model): Arrow[] => {
  switch (model.kind) {
    case "flow": return model.edges;
    case "sequence": return messagesOf(model.messages);
    case "architecture": return model.connections;
  }
};

// The first occurrence of a group keeps its place; its later members move beside it.
export function participantOrder(model: Sequence, answers: Answers): string[] {
  const buckets = new Map<string, string[]>();
  for (const id of model.participants) {
    const group = answers.groups.get(keyOf({ kind: "participant", id }));
    const key = group === undefined ? `participant:${id}` : `group:${group}`;
    const bucket = buckets.get(key);
    if (bucket) bucket.push(id);
    else buckets.set(key, [id]);
  }
  return [...buckets.values()].flat();
}

export function ancestry(model: Architecture, component: string): string[] | undefined {
  if (!Object.hasOwn(model.components, component)) return undefined;
  const fact = model.components[component];
  if (!fact) return undefined;
  const seen = new Set<string>();
  const zones: string[] = [];
  let zone = fact.zone;
  while (zone !== undefined) {
    if (seen.has(zone) || !Object.hasOwn(model.zones, zone)) return undefined;
    seen.add(zone);
    zones.push(zone);
    zone = model.zones[zone].parent;
  }
  return zones;
}

export const untrustedZonesOf = (model: Architecture, component: string) =>
  ancestry(model, component)?.filter((id) => model.zones[id].untrusted);

export function drawnArrows(model: Model): Arrow[] {
  switch (model.kind) {
    case "flow": return model.edges;
    case "sequence": return messagesOf(model.messages).filter((message) =>
      message.type !== "note" && participantsOf(message).every((id) => model.participants.includes(id)));
    case "architecture": return model.connections.filter((connection) =>
      Object.hasOwn(model.components, connection.from) && Object.hasOwn(model.components, connection.to));
  }
}
