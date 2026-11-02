import {
  drawnArrows, labelOf, list, messagesOf, participantsOf, stepOf,
  type Answers, type Architecture, type Arrow, type Check, type Model, type SequenceItem, type Warning,
} from "../ir.ts";
import { widthBudget } from "../backends/svg/text.ts";

// Numeric limits are advice, never rules. Sources and qualifications are in references/principles.md.
export const READABILITY_LIMITS = {
  zoneDepth: 2, // checkchart's choice, after diagram-mistakes guidance on context.
  elements: 12, // checkchart's choice, after Cowan's chunks and advice to split busy charts.
  participants: 6, // checkchart's choice; no study measured a participant limit.
  zoneChildren: 5, // checkchart's choice, after Cowan and Ambler's fewer-than-five swimlanes.
  parallelBranches: 5, // checkchart's choice, after Cowan and Ambler.
  colorGroups: 6, // Moody's approximately six categories per variable, via a secondary source.
  backwardEdges: 2, // checkchart's choice, after the conveyor-belt diagram critique.
  crossings: 0, // checkchart's choice, after Purchase and Ware et al.: reduce crossings.
  arrows: 20, // checkchart's existing choice, shared with the statechart convention.
} as const;

const GENERIC_LABELS = new Set(["uses", "use", "calls", "call", "connects", "connect", "talks to", "使う", "呼ぶ", "接続", "連携", "通信"]);

function zoneChain(model: Architecture, id: string): string[] | undefined {
  const chain: string[] = [];
  let next: string | undefined = id;
  while (next !== undefined) {
    if (chain.includes(next) || !Object.hasOwn(model.zones, next)) return undefined;
    chain.push(next);
    next = model.zones[next].parent;
  }
  return chain.reverse();
}

function arrowName(model: Model, answers: Answers, arrow: Arrow): string {
  const kind = model.kind === "flow" ? "node" : model.kind === "sequence" ? "participant" : "component";
  const ids = "kind" in arrow ? participantsOf(arrow) : [arrow.from, arrow.to];
  const names = ids.map((id) => labelOf(answers, kind, id));
  return "type" in arrow && arrow.type === "note" ? `Note over ${names.join(" and ")}` : names.join(" to ");
}

export function checkReadability(model: Model, answers: Answers): Check {
  const warnings: Warning[] = [];
  const check: Check = { rules: ["PurposeStated"], bugs: [], unchecked: [], warnings };
  const missing = (["title", "reader", "question"] as const).filter((field) => !answers[field]?.trim());
  if (missing.length) check.bugs.push({ rule: "PurposeStated", marks: [], evidence: { kind: "purpose", missing } });
  const warn = (rule: string, detail: string) => warnings.push({ rule, detail });
  const drawn = drawnArrows(model);

  if (model.kind === "architecture") {
    check.rules.push("NoRedundantContainer", "ArrowsLabeled");
    for (const id of Object.keys(model.zones)) {
      const chain = zoneChain(model, id);
      const children = Object.keys(model.zones).filter((child) => model.zones[child].parent === id);
      const components = Object.keys(model.components).filter((child) => model.components[child].zone === id);
      if (chain && children.length === 1 && components.length === 0) check.bugs.push({
        rule: "NoRedundantContainer", marks: [{ kind: "zone", id }],
        evidence: { kind: "architecture", zone: id, detail: `Its only content is the child zone ${labelOf(answers, "zone", children[0])}. Put the outer zone's meaning into the inner zone's label, or draw the sibling that the outer zone is meant to group.` },
      });
      if (chain && chain.length > READABILITY_LIMITS.zoneDepth) warn("DeepNesting",
        `${chain.map((zone) => labelOf(answers, "zone", zone)).join(" > ")} has ${chain.length} zone levels. Flatten the nesting or split the chart to keep at most ${READABILITY_LIMITS.zoneDepth} levels of context.`);
      if (children.length + components.length > READABILITY_LIMITS.zoneChildren) warn("TooManyElements",
        `Zone ${labelOf(answers, "zone", id)} has ${children.length + components.length} children (${list([...children.map((child) => labelOf(answers, "zone", child)), ...components.map((child) => labelOf(answers, "component", child))])}). Split this zone into smaller meaningful groups; aim for at most ${READABILITY_LIMITS.zoneChildren} children.`);
    }
    for (const [index, connection] of model.connections.entries()) {
      if (!drawn.includes(connection)) continue;
      if (!stepOf(answers, connection)?.trim()) check.bugs.push({
        rule: "ArrowsLabeled", marks: [connection.from, connection.to].map((id) => ({ kind: "component", id })),
        evidence: { kind: "architecture", connection: index, detail: "Give this connection a non-empty step label describing what moves or happens." },
      });
      if (connection.dir === "both") warn("TwoWayArrow", `${arrowName(model, answers, connection)}: Split it into two one-way arrows, or say what goes each way in the label.`);
    }
    const specified = Object.entries(model.components).filter(([, fact]) => fact.level !== undefined);
    if (new Set(specified.map(([, fact]) => fact.level)).size > 1) warn("MixedLevels",
      `${specified.map(([id, fact]) => `${labelOf(answers, "component", id)} (${fact.level})`).join(", ")} mix abstraction levels. Put each level in separate charts with its own question.`);
  }

  // Notes are messages too; their text is visible even though they draw no arrow.
  const labeled = model.kind === "sequence" ? messagesOf(model.messages) : drawn;
  for (const arrow of labeled) {
    const label = stepOf(answers, arrow);
    if (label !== null && GENERIC_LABELS.has(label.trim().replace(/[\p{P}\s]+$/gu, "").toLowerCase())) {
      warn("GenericLabel", `${arrowName(model, answers, arrow)} has the generic label ${JSON.stringify(label)}. Describe the action and the data or result, using a verb and a noun.`);
    }
  }

  const kind = model.kind === "flow" ? "node" : model.kind === "sequence" ? "participant" : "component";
  const ids = model.kind === "flow" ? Object.keys(model.nodes) : model.kind === "sequence" ? model.participants : Object.keys(model.components);
  const limit = model.kind === "sequence" ? READABILITY_LIMITS.participants : READABILITY_LIMITS.elements;
  if (ids.length > limit) warn("TooManyElements",
    `The chart has ${ids.length} ${kind}s (${list(ids.map((id) => labelOf(answers, kind, id)))}). Split it into charts that each answer one question; aim for at most ${limit} ${kind}s.`);

  if (model.kind === "sequence") {
    const visit = (items: SequenceItem[], path: string) => {
      for (const [index, item] of items.entries()) if (item.kind === "parallel") {
        const here = `${path}[${index}].par`;
        if (item.par.length > READABILITY_LIMITS.parallelBranches) {
          const names = item.par.map((branch, index) => answers.branchLabels.get(branch) ?? item.branches?.[index] ?? `Branch ${index + 1}`);
          warn("TooManyElements", `${here} has ${item.par.length} branches (${list(names)}). Split this parallel block into smaller charts; aim for at most ${READABILITY_LIMITS.parallelBranches} branches.`);
        }
        for (const [index, branch] of item.par.entries()) visit(branch, `${here}[${index}]`);
      }
    };
    visit(model.messages, "messages");
  }
  const groups = [...new Set(answers.groups.values())];
  if (groups.length > READABILITY_LIMITS.colorGroups) warn("TooManyElements",
    `The chart uses ${groups.length} color groups (${list(groups)}). Reduce the categories or split the chart; aim for at most ${READABILITY_LIMITS.colorGroups} color groups.`);

  if (model.kind === "flow") {
    // The model declares the main reading order; do not infer intent from ids.
    const order = new Map(Object.keys(model.nodes).map((id, index) => [id, index]));
    const back = model.edges.filter((edge) => order.get(edge.to)! < order.get(edge.from)!);
    if (back.length > READABILITY_LIMITS.backwardEdges) warn("FlowLoopsBack",
      `${back.length} edges return to earlier nodes in the declared main order (${back.map((edge) => arrowName(model, answers, edge)).join(", ")}). Use a sequence diagram to show the exchanges, or split the flow into smaller questions.`);
  }
  return check;
}

export function crossingWarnings(count: number): Warning[] {
  return count > READABILITY_LIMITS.crossings ? [{
    rule: "Crossings", detail: `The final layout has ${count} ${count === 1 ? "crossing" : "crossings"} between arrows. Reroute the arrows or split the chart to keep the main path clear.`,
  }] : [];
}

export function widthWarnings(width: number): Warning[] {
  const rendered = Math.round(width * 100) / 100;
  return rendered > widthBudget ? [{ rule: "WideChart",
    detail: `The chart is ${rendered} px wide; documents shrink it and the text gets small. Shorten the labels, split the chart, or use direction TB.`,
  }] : [];
}
