import path from "node:path";
import { pathToFileURL } from "node:url";
import { inspect } from "node:util";
import {
  COLORS, arrowsOf, elementsOf, isPlainObject, keyOf, list, messageOf,
  type Answers, type Color, type Element, type Model,
} from "../ir.ts";

const EXPORTS = ["title", "reader", "question", "product", "colors", "label", "group", "step"];
type Callback = (...args: unknown[]) => unknown;
type Mapper = Callback | Record<string, unknown>;
const isFunction = (value: unknown): value is Callback => typeof value === "function";
export type View = {
  title?: string;
  reader?: string;
  question?: string;
  product?: string;
  colors: Map<string, Color>;
  label?: Mapper;
  group?: Mapper;
  step?: Callback;
};
const literal = (value: unknown) => typeof value === "string" ? JSON.stringify(value) : inspect(value, { breakLength: Infinity });

const isColor = (value: unknown): value is Color => typeof value === "string" && Object.hasOwn(COLORS, value);
function optionalText(value: unknown, name: string): string | undefined {
  if (value === undefined || typeof value === "string") return value;
  throw new Error(`The view's ${name} must be a string.`);
}
function mapper(value: unknown, name: string): Mapper | undefined {
  if (value === undefined || isFunction(value) || isPlainObject(value)) return value;
  throw new Error(`The view's ${name} must be a function or a plain object.`);
}

export function checkView(view: Record<string, unknown>): View {
  const extra = Object.keys(view).filter((name) => !EXPORTS.includes(name));
  if (extra.length) throw new Error(`The view exports ${list(extra)}, which the command does not read. Export only ${list(EXPORTS)}.`);
  const { product, step } = view;
  const title = optionalText(view.title, "title");
  const reader = optionalText(view.reader, "reader");
  const question = optionalText(view.question, "question");
  if (product !== undefined && (typeof product !== "string" || !product.trim())) throw new Error("The view's product must be a nonempty string.");
  if (step !== undefined && !isFunction(step)) throw new Error("The view's step must be a function.");
  const label = mapper(view.label, "label");
  const group = mapper(view.group, "group");
  if (view.colors !== undefined && !isPlainObject(view.colors)) throw new Error("The view's colors must be a plain object.");
  if (group !== undefined && view.colors === undefined) throw new Error("The view exports group but no colors. Give each group a color in colors.");
  const colors = new Map<string, Color>();
  if (isPlainObject(view.colors)) for (const [name, color] of Object.entries(view.colors)) {
    if (!isColor(color)) throw new Error(`The view's colors give ${JSON.stringify(name)} the color ${literal(color)}. Give each group ${list(Object.keys(COLORS), "or")}.`);
    colors.set(name, color);
  }
  if (label !== undefined && typeof label !== "function") for (const [id, text] of Object.entries(label)) {
    if (typeof text !== "string") throw new Error(`The view's label[${JSON.stringify(id)}] must be a string, but got ${literal(text)}.`);
  }
  const checkGroup = (value: unknown, where: string) => {
    if (value !== undefined && (typeof value !== "string" || !colors.has(value))) {
      throw new Error(`The view's ${where} returned ${literal(value)}, which colors does not name. Give each group a color in colors.`);
    }
  };
  if (group !== undefined && typeof group !== "function") for (const [id, name] of Object.entries(group)) checkGroup(name, `group[${JSON.stringify(id)}]`);
  return { title, reader, question, product, colors, label, group, step };
}

export async function loadView(file?: string): Promise<View> {
  if (file === undefined) return checkView({});
  try { return checkView(await import(pathToFileURL(path.resolve(file)).href)); }
  catch (error) { throw new Error(`Cannot use the view: ${messageOf(error)}`); }
}

function ask(mapper: Mapper | undefined, element: Element): unknown {
  if (typeof mapper === "function") return mapper(element.id, element.kind, element.fact);
  return mapper !== undefined && Object.hasOwn(mapper, element.id) ? mapper[element.id] : undefined;
}

export function answersOf(model: Model, view: View): Answers {
  const answers: Answers = { title: view.title, reader: view.reader, question: view.question, product: view.product, colors: view.colors, labels: new Map(), branchLabels: new Map(), groups: new Map(), steps: new Map() };
  for (const element of elementsOf(model)) {
    const key = keyOf(element);
    let text: unknown;
    let group: unknown;
    try {
      text = view.label === undefined ? element.id : ask(view.label, element);
      // A missing entry in a label map uses the default; a function must return a string.
      if (text === undefined && typeof view.label !== "function") text = element.id;
      if (element.kind !== "zone" && element.kind !== "branch") group = ask(view.group, element);
    } catch (error) { throw new Error(`The view failed for ${element.kind} ${JSON.stringify(element.id)}: ${messageOf(error)}`); }
    if (typeof text !== "string") throw new Error(`The view's label for ${element.kind} ${JSON.stringify(element.id)} must be a string, but got ${literal(text)}.`);
    if (element.kind === "branch") answers.branchLabels.set(element.fact, text);
    else answers.labels.set(key, text);
    if (group !== undefined) {
      if (typeof group !== "string" || !view.colors.has(group)) throw new Error(`The view's group for ${element.kind} ${JSON.stringify(element.id)} returned ${literal(group)}, which colors does not name. Give each group a color in colors.`);
      answers.groups.set(key, group);
    }
  }
  for (const [index, arrow] of arrowsOf(model).entries()) {
    let text: unknown;
    try {
      text = view.step ? view.step(arrow) : "kind" in arrow
        ? arrow.id ?? arrow.type : "when" in arrow ? arrow.when ?? null : null;
    } catch (error) { throw new Error(`The view's step() failed for item ${index + 1}: ${messageOf(error)}`); }
    if (typeof text !== "string" && (text !== null || model.kind === "sequence")) {
      throw new Error(`The view's step() for item ${index + 1} must return ${model.kind === "sequence" ? "a string" : "a string or null"}, but got ${literal(text)}.`);
    }
    answers.steps.set(arrow, text);
  }
  return answers;
}
