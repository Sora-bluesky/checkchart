import {
  arrowsOf, drawnArrows, elementsOf, keyOf, participantsOf, stepOf,
  type Answers, type Arrow, type Bug, type Model, type Ref,
} from "../ir.ts";
import { flowRoutes } from "./flow.ts";

export function checkProduct(model: Model, answers: Answers): Bug[] {
  if (answers.product === undefined) return [];
  const product = answers.product;
  const pattern = new RegExp(product.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "giu");
  const routes = model.kind === "flow" ? flowRoutes(model) : undefined;
  const bugs: Bug[] = [];
  const drawn: { element: string; text: string; marks: Ref[]; ref?: Ref; arrow?: Arrow; name: boolean }[] = [];
  if (answers.title !== undefined) drawn.push({ element: "Title", text: answers.title, marks: [], name: true });
  for (const ref of elementsOf(model)) {
    const text = ref.kind === "branch" ? answers.branchLabels.get(ref.fact) ?? ref.id : answers.labels.get(keyOf(ref)) ?? ref.id;
    drawn.push({ element: `${ref.kind} label`, text, marks: [ref], ref, name: true });
  }
  const visibleArrows = new Set(drawnArrows(model));
  for (const [index, arrow] of arrowsOf(model).entries()) {
    if (model.kind === "architecture" && !visibleArrows.has(arrow)) continue;
    const text = stepOf(answers, arrow);
    if (text === null) continue;
    const ids = "kind" in arrow ? participantsOf(arrow) : [arrow.from, arrow.to];
    const kind = model.kind === "flow" ? "node" : model.kind === "sequence" ? "participant" : "component";
    drawn.push({ element: `Item ${index + 1} label`, text, marks: ids.map((id) => ({ kind, id })), arrow, name: false });
  }
  const groups = new Set(answers.groups.values());
  for (const group of groups) drawn.push({
    element: "Group name", text: group,
    marks: elementsOf(model).filter((ref) => answers.groups.get(keyOf(ref)) === group), name: false,
  });
  let appears = false;
  for (const item of drawn) {
    // Test boundaries without /i: only ASCII letters and digits join tokens,
    // even when Unicode case folding also recognizes non-ASCII letters.
    const matches = [...item.text.matchAll(pattern)].filter((match) =>
      !/[A-Za-z0-9]/.test(item.text[match.index - 1] ?? "") &&
      !/[A-Za-z0-9]/.test(item.text[match.index + match[0].length] ?? ""));
    if (item.name && matches.length) appears = true;
    if (matches.some((match) => match[0] !== product)) bugs.push({
      rule: "ProductName", marks: item.marks,
      evidence: model.kind === "flow" && item.ref?.kind === "node"
        ? { kind: "flow", node: item.ref.id, ...routes?.get(item.ref.id) }
        : { kind: "product", element: item.element, text: item.text, ref: item.ref, arrow: item.arrow },
    });
  }
  if (!appears) bugs.push({
    rule: "ProductName", marks: [],
    evidence: { kind: "product", element: "The product name is missing from the title and labels", text: product },
  });
  return bugs;
}
