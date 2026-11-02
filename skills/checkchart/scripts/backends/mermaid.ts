import {
  COLORS, byText, keyOf, labelOf, participantOrder, participantsOf, stepOf,
  type Answers, type Bug, type Check, type Model, type Ref,
  type Sequence, type SequenceItem,
} from "../ir.ts";
import { graphPresentation, sequenceMarks, zoneParents } from "./presentation.ts";

// Adapted from pstack's statechart skill. See NOTICE for the license.
const BLANK = /[\t-\r\u0085\p{Zl}\p{Zp}]/u;
const SPACE = /\p{Zs}/u;
const CONTROL = /[\p{Cc}\p{Cf}]/u;
const SAFE = /^[\p{L}\p{N} !'()+,\-./=?"_|@{}\\^%<>]$/u;
const HAZARD = /:(?=:|$|\S*#)|\\(?=n)|%(?=%)|<(?=[\p{L}/!?])|_(?![\p{L}\p{N}])|(?<![\p{L}\p{N}])_/giu;
const DIRECTION = /(direction)\s+(?=LR|RL|TB|BT)/gi;
const C4 = /C4(?=Container|Component|Dynamic|Deployment)/g;
const UNDRAWN = /[\0\x80-\x9f]/;
const MARKER = /(?<=marker-end=)"/g;
const firstOf = new Map<number, number>();
for (const pair of ["ﬂ°", "¶ß"]) {
  const [first, second] = [...pair].map((c) => c.codePointAt(0) ?? 0);
  firstOf.set(second, first);
}
const KEPT = 0;
const BLANKED = 1;
const DROPPED = 2;
const CODED = 3;
const JOINS = 4;
const kindOf = (n: number) => {
  const c = String.fromCodePoint(n);
  // Visible Unicode spaces stay distinct. Encode syntax triggers before Mermaid
  // can interpret icons, links, emphasis or code instead of literal label text.
  const safe = (n > 127 && !CONTROL.test(c) && !SPACE.test(c)) || SAFE.test(c);
  const kind = c === " " ? KEPT : BLANK.test(c) ? BLANKED : UNDRAWN.test(c) ? DROPPED : safe ? KEPT : CODED;
  return firstOf.has(n) ? kind | JOINS : kind;
};
const ASCII = Uint8Array.from({ length: 128 }, (_, n) => kindOf(n));
const wide = new Map<number, number>();
const kindAt = (n: number) => {
  if (n < 128) return ASCII[n];
  let kind = wide.get(n);
  if (kind === undefined) wide.set(n, (kind = kindOf(n)));
  return kind;
};
const encode = (s: string, ref: (n: number) => string) => {
  let out = "";
  let run = 0;
  let last = -1;
  for (let i = 0; i < s.length;) {
    let n = s.charCodeAt(i);
    let width = 1;
    let malformed = false;
    if (n >= 0xd800 && n <= 0xdfff) {
      const low = s.charCodeAt(i + 1);
      if (n <= 0xdbff && low >= 0xdc00 && low <= 0xdfff) {
        n = 0x10000 + ((n - 0xd800) << 10) + (low - 0xdc00);
        width = 2;
      } else { n = 0xfffd; malformed = true; }
    }
    let kind = malformed ? CODED : kindAt(n);
    if (kind === DROPPED) {
      out += s.slice(run, i);
      run = i + width;
    } else {
      const joined = kind >= JOINS && firstOf.get(n) === last;
      kind &= ~JOINS;
      if (joined || kind !== KEPT) {
        out += s.slice(run, i);
        if (joined) out += ref(0x2060);
        if (kind === KEPT) run = i;
        else {
          out += kind === BLANKED ? " " : ref(n);
          run = i + width;
        }
      }
      last = n;
    }
    i += width;
  }
  return out + s.slice(run);
};
const code = (s: string, ref: (n: number) => string) => encode(s, ref)
  .replace(MARKER, `${ref(0x2060)}"`)
  .replace(HAZARD, (c) => ref(c.charCodeAt(0)));
export const esc = (s: string, quoted = false) => {
  const plain = code(s, (n) => `#${n};`);
  const out = quoted ? plain.replaceAll('"', "#34;") : plain;
  if (!out.trim()) return "#32;";
  const turned = out.replace(DIRECTION, "$1#32;");
  return turned.includes("C4") ? turned.replace(C4, "C#52;") : turned;
};

// Only our line breaks become markup. Text supplied by the view stays text.
const text = (s: string) => s.split(/\r\n|\r|\n/).map((line) => esc(line, true).replaceAll("<", "#60;").replace(/\bend\b/gi, (word) => `#${word.charCodeAt(0)};${word.slice(1)}`)).join("<br/>");
const BREAKS = "fill:#ffecee,stroke:#e72e3b,stroke-width:2.5px,color:#cd2834";

function graph(model: Exclude<Model, Sequence>, answers: Answers, check: Check, fill: boolean): string[] {
  const body: string[] = [];
  const marks: string[] = [];
  const refs: Ref[] = model.kind === "flow"
    ? Object.keys(model.nodes).map((id) => ({ kind: "node", id }))
    : [
        ...Object.keys(model.zones).map((id): Ref => ({ kind: "zone", id })),
        ...Object.keys(model.components).map((id): Ref => ({ kind: "component", id })),
      ];
  const nodeIds = new Map<string, string>();
  let nextNode = 0;
  let nextZone = 0;
  for (const ref of refs) nodeIds.set(keyOf(ref), ref.kind === "zone" ? `z${nextZone++}` : `n${nextNode++}`);
  const idOf = (kind: Ref["kind"], id: string) => nodeIds.get(keyOf({ kind, id }));
  const { broken, trail, legend } = graphPresentation(model, answers, check);
  for (const ref of refs) {
    const key = keyOf(ref);
    const group = answers.groups.get(key);
    const color = group === undefined ? undefined : answers.colors.get(group);
    const untrusted = model.kind === "architecture" && ref.kind === "zone" && model.zones[ref.id].untrusted;
    for (const cls of [color, untrusted && "untrusted", broken.has(key) && "breaks", trail.has(key) && "bugPath"]) {
      if (cls) marks.push(`  class ${nodeIds.get(key)} ${cls}`);
    }
  }
  const shape = (kind: Ref["kind"], id: string, form: string, indent: string) => {
    const value = `"${text(labelOf(answers, kind, id))}"`;
    const node = idOf(kind, id);
    const box = form === "decision" ? `{${value}}` : form === "store" ? `[(${value})]`
      : ["start", "end", "person"].includes(form) ? `([${value}])`
      : form === "external" ? `[/${value}/]` : `[${value}]`;
    body.push(`${indent}${node}${box}`);
  };
  if (model.kind === "flow") for (const [id, node] of Object.entries(model.nodes)) shape("node", id, node.type, "  ");
  else {
    // Invalid ancestry is reported, and is drawn flat rather than guessed.
    const parents = zoneParents(model);
    const tree = (parent: string | undefined, indent: string) => {
      for (const id of Object.keys(model.zones)) if (parents.get(id) === parent) {
        body.push(`${indent}subgraph ${idOf("zone", id)}["${text(labelOf(answers, "zone", id))}"]`);
        tree(id, indent + "  ");
        for (const [component, fact] of Object.entries(model.components)) if (fact.zone === id) shape("component", component, fact.shape, indent + "  ");
        body.push(`${indent}end`);
      }
    };
    tree(undefined, "  ");
    for (const [id, component] of Object.entries(model.components)) {
      if (component.zone === undefined || !Object.hasOwn(model.zones, component.zone)) shape("component", id, component.shape, "  ");
    }
  }
  const edges = model.kind === "flow" ? model.edges : model.connections;
  const nodeKind = model.kind === "flow" ? "node" : "component";
  for (const edge of edges) {
    const from = idOf(nodeKind, edge.from);
    const to = idOf(nodeKind, edge.to);
    if (!from || !to) continue;
    const both = "dir" in edge && edge.dir === "both";
    const arrow = edge.style === "dashed" ? both ? "<-.->" : "-.->" : both ? "<-->" : "-->";
    const label = stepOf(answers, edge);
    body.push(`  ${from} ${arrow}${label === null ? "" : `|"${text(label)}"|`} ${to}`);
  }
  const lines = [`flowchart ${model.direction}`];
  if (legend.length) {
    lines.push('  subgraph legend["Legend"]', "    direction LR");
    for (const [index, [label]] of legend.entries()) lines.push(`    lg${index}["${text(label)}"]`);
    if (legend.length > 1) lines.push(`    ${legend.map((_, index) => `lg${index}`).join(" ~~~ ")}`);
    lines.push("  end");
    for (const [index, [, cls]] of legend.entries()) lines.push(`  class lg${index} ${cls}`);
  }
  lines.push(...body);
  if (legend.some(([, cls]) => cls === "untrusted")) lines.push("  classDef untrusted fill:#f6f7f9,stroke:#4b525d,stroke-width:2px,stroke-dasharray:6 4");
  if (check.bugs.length) lines.push(`  classDef breaks ${BREAKS}`);
  if (fill) {
    for (const [color, hex] of Object.entries(COLORS)) lines.push(`  classDef ${color} fill:${hex}`);
    lines.push("  classDef bugPath stroke:#1680f3,stroke-width:2.5px");
  }
  return [...lines, ...marks];
}

function sequence(model: Sequence, answers: Answers, bugs: Bug[], fill: boolean): string[] {
  const lines = ["sequenceDiagram"];
  const order = participantOrder(model, answers);
  const ids = new Map(order.map((id, index) => [id, `p${index}`]));
  let open: string | undefined;
  for (const id of order) {
    const group = answers.groups.get(keyOf({ kind: "participant", id }));
    if (group !== open) {
      if (open !== undefined) lines.push("  end");
      if (group !== undefined) {
        const color = answers.colors.get(group);
        lines.push(`  box ${fill && color ? COLORS[color] : "transparent"} ${text(group)}`);
      }
      open = group;
    }
    lines.push(`${open === undefined ? "  " : "    "}participant ${ids.get(id)} as ${text(labelOf(answers, "participant", id))}`);
  }
  if (open !== undefined) lines.push("  end");
  const { messageRules, standalone } = sequenceMarks(model, { bugs, rules: [], unchecked: [] });
  for (const mark of standalone) {
    lines.push("  rect rgb(255, 236, 238)");
    const id = mark.ref ? ids.get(mark.ref.id) : ids.values().next().value;
    lines.push(id ? `    Note right of ${id}: Breaks ${mark.rule}` : `    %% Breaks ${mark.rule}`);
    lines.push("  end");
  }
  let index = 0;
  const draw = (items: SequenceItem[], indent: string) => {
    for (const item of items) {
      if (item.kind === "parallel") {
        for (const [branch, messages] of item.par.entries()) {
          const label = item.branches === undefined ? `Branch ${branch + 1}` : answers.branchLabels.get(messages) ?? item.branches[branch];
          lines.push(`${indent}${branch === 0 ? "par" : "and"} ${text(label)}`);
          draw(messages, indent + "  ");
        }
        lines.push(`${indent}end`);
        continue;
      }
      const rules = messageRules.get(index++) ?? [];
      if (rules.length) lines.push(`${indent}rect rgb(255, 236, 238)`);
      const inside = indent + (rules.length ? "  " : "");
      const label = text(stepOf(answers, item) ?? "");
      const participants = participantsOf(item);
      const target = ids.get(participants.at(-1) ?? "") ?? ids.values().next().value;
      if (participants.some((id) => !ids.has(id))) {
        lines.push(target ? `${inside}Note right of ${target}: ${label} (undeclared participant)` : `${inside}%% Undeclared participant`);
      } else if (item.type === "note") lines.push(`${inside}Note over ${item.over.map((id) => ids.get(id)).join(",")}: ${label}`);
      else {
        const arrow = item.type === "reply" ? "-->>" : item.type === "signal" ? "-)" : item.type === "lost" ? "--x" : "->>";
        lines.push(`${inside}${ids.get(item.from)}${arrow}${ids.get(item.to)}: ${label}`);
      }
      for (const rule of [...new Set(rules)].sort(byText)) {
        lines.push(target ? `${inside}Note right of ${target}: Breaks ${rule}` : `${inside}%% Breaks ${rule}`);
      }
      if (rules.length) lines.push(`${indent}end`);
    }
  };
  draw(model.messages, "  ");
  return lines;
}

export function mermaid(model: Model, answers: Answers, check: Check, fill = false): string {
  const lines: string[] = [];
  const title = answers.title && code(answers.title, (n) => `ﬂ°°${n}¶ß`).replaceAll("<", "ﬂ°°60¶ß");
  if (title) lines.push("---", `title: ${JSON.stringify(title)}`, "---");
  lines.push(...(model.kind === "sequence" ? sequence(model, answers, check.bugs, fill) : graph(model, answers, check, fill)));
  return lines.join("\n") + "\n";
}
