import {
  byText, elementsOf, keyOf, messagesOf,
  type Answers, type Check, type Model, type Ref, type Sequence,
} from "../ir.ts";
import { captions } from "./captions.ts";

export const ruleNames = (rules: Iterable<string>, separator: string) => [...new Set(rules)].sort(byText).join(separator);

// Both renderers use the same marks, paths, legend wording and invalid-zone policy.
export function graphPresentation(model: Model, answers: Answers, check: Check) {
  const caption = captions[answers.locale ?? "en"];
  const broken = new Set(check.bugs.flatMap((bug) => bug.marks.map(keyOf)));
  const trail = new Set<string>();
  const pathRules = new Set<string>();
  for (const bug of check.bugs) if (bug.evidence.kind === "flow" && bug.evidence.start !== undefined) {
    pathRules.add(bug.rule);
    trail.add(keyOf({ kind: "node", id: bug.evidence.start }));
    for (const edge of bug.evidence.path ?? []) trail.add(keyOf({ kind: "node", id: edge.to }));
  }
  const used = new Set(elementsOf(model).map((ref) => answers.groups.get(keyOf(ref))));
  const legend: [string, string][] = [];
  for (const [group, color] of answers.colors) if (used.has(group)) legend.push([group, color]);
  if (model.kind === "architecture" && Object.values(model.zones).some((zone) => zone.untrusted)) legend.push([caption.untrusted, "untrusted"]);
  if (check.bugs.length) legend.push([caption.breaks(ruleNames(check.bugs.map((bug) => bug.rule), caption.ruleSeparator)), "breaks"]);
  if (trail.size) legend.push([caption.bugPath(ruleNames(pathRules, caption.ruleSeparator)), "bugPath"]);
  return { broken, trail, legend };
}

export function sequenceMarks(model: Sequence, check: Check) {
  const messages = messagesOf(model.messages);
  const messageRules = new Map<number, string[]>();
  const standalone: { ref?: Ref; rule: string }[] = [];
  for (const bug of check.bugs) {
    const evidence = bug.evidence;
    const index = evidence.kind === "sequence" ? evidence.index
      : evidence.kind === "product" && evidence.arrow ? messages.findIndex((message) => message === evidence.arrow) : undefined;
    if (index !== undefined && index >= 0) {
      const rules = messageRules.get(index) ?? [];
      rules.push(bug.rule);
      messageRules.set(index, rules);
    } else standalone.push({ ref: bug.marks.find((ref) => ref.kind === "participant"), rule: bug.rule });
  }
  return { messageRules, standalone };
}

export function zoneParents(model: Extract<Model, { kind: "architecture" }>) {
  const parents = new Map<string, string | undefined>();
  for (const [id, zone] of Object.entries(model.zones)) {
    let parent = zone.parent;
    const seen = new Set([id]);
    let valid = true;
    while (parent !== undefined) {
      if (seen.has(parent) || !Object.hasOwn(model.zones, parent)) { valid = false; break; }
      seen.add(parent);
      parent = model.zones[parent].parent;
    }
    parents.set(id, valid ? zone.parent : undefined);
  }
  return parents;
}
