import {
  byText, drawnArrows, labelOf as rawLabelOf, list, messagesOf, participantOrder, participantsOf, stepOf as rawStepOf,
  type Answers, type Architecture, type Bug, type Check, type Model, type Sequence,
} from "../ir.ts";
import { READABILITY_LIMITS } from "../passes/readability.ts";

// A view's hard line breaks belong in the chart, never inside a numbered path.
const oneLine = (text: string) => text.split(/\r\n|\r|\n/).join(" ");
const labelOf = (...args: Parameters<typeof rawLabelOf>) => oneLine(rawLabelOf(...args));
const stepOf = (...args: Parameters<typeof rawStepOf>) => {
  const text = rawStepOf(...args);
  return text === null ? null : oneLine(text);
};

function sequencePath(model: Sequence, index: number, involved: string[]) {
  const names = new Set(involved);
  return messagesOf(model.messages).slice(0, index + 1)
    .map((message, index) => ({ message, index }))
    .filter(({ message }) => participantsOf(message).every((id) => names.has(id)));
}

function pathLength(model: Model, bug: Bug) {
  const evidence = bug.evidence;
  if (evidence.kind === "flow") return evidence.node === undefined ? 0 : evidence.path?.length ?? Infinity;
  if (evidence.kind === "sequence") return evidence.index === undefined || model.kind !== "sequence" ? 0 : sequencePath(model, evidence.index, evidence.involved).length;
  return evidence.kind === "architecture" && evidence.untrusted ? 1 : 0;
}

function story(model: Model, answers: Answers, bug: Bug): string[] {
  const evidence = bug.evidence;
  switch (evidence.kind) {
    case "purpose": return [`Missing: ${list(evidence.missing)}. Give the view a non-empty title, reader and question before drawing.`];
    case "flow": {
      if (evidence.node === undefined) return ["The model needs at least one start and one end."];
      const label = labelOf(answers, "node", evidence.node);
      const lines = evidence.path === undefined || evidence.start === undefined
        ? [`No path from a start reaches ${label}.`]
        : [
            `The shortest path has ${evidence.path.length} ${evidence.path.length === 1 ? "step" : "steps"}:`,
            `0. ${labelOf(answers, "node", evidence.start)}`,
            ...evidence.path.map((edge, index) => {
              const step = stepOf(answers, edge);
              return `${index + 1}. ${step ? `${step}: ` : ""}${labelOf(answers, "node", edge.to)}`;
            }),
          ];
      if (bug.rule === "ReachesEnd") {
        lines.push("From here no path reaches an end.");
        if (evidence.cycle) {
          const labels = evidence.cycle.map((id) => JSON.stringify(labelOf(answers, "node", id)));
          lines.push(labels.length === 1 ? `The run stays in ${labels[0]} forever.` : `The run loops through ${list(labels)} forever.`);
        }
      } else if (bug.rule === "HasExit") lines.push("This node has no edge to a node other than a store.");
      else if (bug.rule === "DecisionBranches") lines.push("A decision needs at least two outgoing edges, each with a different condition.");
      else if (bug.rule === "EndIsFinal") lines.push("An end may lead only to stores.");
      return lines;
    }
    case "sequence": {
      if (evidence.index === undefined) return [`${labelOf(answers, "participant", evidence.participant ?? "")}: ${evidence.detail}`];
      const messages = messagesOf((model as Sequence).messages).slice(0, evidence.index + 1);
      const path = sequencePath(model as Sequence, evidence.index, evidence.involved);
      const lines = [`The path to it has ${path.length} messages, numbered in the order of the chart:`];
      for (const { message, index } of path) {
        const label = stepOf(answers, message) ?? message.type;
        const endpoints = participantsOf(message).map((id) => labelOf(answers, "participant", id));
        lines.push(`${index}. ${message.type === "note" ? `Note over ${endpoints.join(", ")}` : endpoints.join(" to ")}: ${label}`);
      }
      if (path.length < messages.length) lines.push("(other messages left out)");
      lines.push(evidence.detail);
      return lines;
    }
    case "architecture": {
      if (evidence.connection !== undefined) {
        const architecture = model as Architecture;
        const connection = architecture.connections[evidence.connection];
        const from = labelOf(answers, "component", connection.from);
        const to = labelOf(answers, "component", connection.to);
        if (bug.rule === "ArrowsLabeled") return [
          "The shortest path has 1 step:", `0. ${from}`, `1. ${to}`, evidence.detail,
        ];
        if (evidence.untrusted) {
          const input = evidence.untrusted;
          const sender = labelOf(answers, "component", input.from);
          const receiver = labelOf(answers, "component", input.to);
          const zones = list(input.zones.map((id) => labelOf(answers, "zone", id)));
          return [
            "The shortest path has 1 step:",
            `0. ${sender} (untrusted, inside ${zones})`,
            `1. ${stepOf(answers, connection) || "connects to"}: ${receiver} (trusted)`,
            `Nothing checks what ${receiver} receives from untrusted content.`,
          ];
        }
        return [`${from} to ${to}: ${evidence.detail}`];
      }
      const label = evidence.zone === undefined ? labelOf(answers, "component", evidence.component ?? "") : labelOf(answers, "zone", evidence.zone);
      return [`${label}: ${oneLine(evidence.detail)}`];
    }
    case "product": return [`${evidence.element}: ${JSON.stringify(evidence.text)}`];
  }
}

export function report(model: Model, answers: Answers, check: Check, modelName: string): string {
  const size = model.kind === "flow" ? Object.keys(model.nodes).length : model.kind === "sequence" ? model.participants.length : Object.keys(model.components).length;
  const count = model.kind === "flow" ? model.edges.length : model.kind === "sequence" ? messagesOf(model.messages).length : model.connections.length;
  const nouns = model.kind === "flow" ? ["nodes", "edges"] : model.kind === "sequence" ? ["participants", "messages"] : ["components", "connections"];
  const arrows = drawnArrows(model).length;
  const lines = [
    `# ${oneLine(answers.title?.trim() ? answers.title : modelName)}`, "",
    `Reader: ${oneLine(answers.reader?.trim() ? answers.reader : "Not stated.")}`,
    `Question: ${oneLine(answers.question?.trim() ? answers.question : "Not stated.")}`, "",
    `The model has ${size} ${nouns[0]} and ${count} ${nouns[1]}. The chart draws ${size} ${nouns[0]} and ${arrows} arrows.`,
  ];
  if (arrows > READABILITY_LIMITS.arrows) lines.push(`The chart draws ${arrows} arrows, more than the budget of about ${READABILITY_LIMITS.arrows}, so it may be hard to read. Merge steps or split the chart.`);
  if (model.kind === "sequence" && participantOrder(model, answers).some((id, index) => id !== model.participants[index])) {
    lines.push("The chart reorders participants so that each group is contiguous. It keeps the order of first appearances and the order within each group.");
  }
  if (model.kind === "architecture" && check.bugs.some((bug) => bug.rule === "EndsDeclared")) {
    lines.push("The chart leaves out connections with undeclared ends. Zones with missing or cyclic parents are drawn at the top level; components with missing zones are drawn outside zones.");
  }
  for (const rule of check.rules) {
    const bugs = check.bugs.filter((bug) => bug.rule === rule).sort((a, b) => pathLength(model, a) - pathLength(model, b));
    for (const bug of bugs.slice(0, 5)) lines.push("", `## ${rule} breaks`, ...story(model, answers, bug));
    if (bugs.length > 5) lines.push(`and ${bugs.length - 5} more`);
  }
  if (model.kind === "sequence" && check.bugs.length) lines.push("", "## Marks", ...[...new Set(check.bugs.map((bug) => bug.rule))].sort(byText).map((rule) => `- Breaks ${rule}: a pale red box and a note naming the rule.`));
  lines.push("", "## Warnings", ...(check.warnings?.length ? check.warnings.map((warning) => `- ${warning.rule}: ${oneLine(warning.detail)}`) : ["None."]));
  const holds = check.rules.filter((rule) => !check.bugs.some((bug) => bug.rule === rule) && !check.unchecked.some((text) => text.startsWith(rule + " ")));
  lines.push("", "## Rules that hold", holds.length ? holds.join(", ") : "None.");
  const omitted = model.kind === "flow"
    ? ["whether a condition can actually be true", "whether the steps describe what the system really does"]
    : model.kind === "sequence"
      ? ["whether the order of messages is right for the protocol", "timing beyond the declared timeouts", "whether parallel branches can really run together"]
      : ["whether checkedBy really validates its input", "data flow inside a component"];
  lines.push("", "## Checks not made", ...[...check.unchecked, ...omitted].map((text) => `- ${text}`));
  return lines.join("\n").replace(/\r\n?/g, "\n") + "\n";
}
