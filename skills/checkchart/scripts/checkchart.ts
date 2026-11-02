#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { loadModel } from "./frontends/model.ts";
import { answersOf, loadView } from "./frontends/view.ts";
import { checkFlow } from "./passes/flow.ts";
import { checkSequence } from "./passes/sequence.ts";
import { checkArchitecture } from "./passes/architecture.ts";
import { checkProduct } from "./passes/product.ts";
import { checkReadability, crossingWarnings, widthWarnings } from "./passes/readability.ts";
import { mermaid } from "./backends/mermaid.ts";
import { report } from "./backends/report.ts";
import { messageOf } from "./ir.ts";

const USAGE = `Usage: checkchart MODEL.json [--view FILE] [--out DIR] [--fill] [--svg]

Checks the facts and draws a Mermaid flowchart, sequence or architecture diagram.
  --view FILE  A module exporting title, reader, question, product, locale, colors, label, group, and step.
  --out DIR    A new or empty output folder. Default: MODEL-chart beside the model.
  --fill       Add light group colors and the bug path style for other viewers.
  --svg        Also draw chart.svg with the optional elkjs package.
Exit code: 0 when every rule holds, 1 when a rule breaks, 2 on an input error.
Only exits 0 and 1 write chart.mmd and report.md.`;

const codeOf = (error: unknown) => error instanceof Error && "code" in error ? error.code : undefined;

function destination(out: string): string {
  try {
    const entries = fs.readdirSync(out);
    if (entries.length) throw new Error(`${out} is not empty. It has ${entries.sort()[0]}. The command writes only to a new or empty folder. Pass --out with a new folder.`);
    return fs.realpathSync(out);
  } catch (error) {
    if (codeOf(error) !== "ENOENT") throw error;
    if (fs.lstatSync(out, { throwIfNoEntry: false })) throw new Error(`${out} is a broken link. Pass --out with a new folder.`);
    return path.resolve(out);
  }
}

function writeFiles(out: string, dest: string, chart: string, text: string, image?: string) {
  // Prepare every file before publishing the folder. A view cannot make us overwrite a file.
  if (destination(out) !== dest) throw new Error("The output folder changed while the check ran. Pass --out with a new folder.");
  let base = path.dirname(dest);
  while (!fs.existsSync(base)) base = path.dirname(base);
  const stage = fs.mkdtempSync(path.join(base, ".checkchart-"));
  let removedEmpty = false;
  try {
    fs.writeFileSync(path.join(stage, "chart.mmd"), chart, "utf8");
    fs.writeFileSync(path.join(stage, "report.md"), text, "utf8");
    if (image !== undefined) fs.writeFileSync(path.join(stage, "chart.svg"), image, "utf8");
    if (destination(out) !== dest) throw new Error("The output folder changed while the check ran. Pass --out with a new folder.");
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    if (fs.existsSync(dest)) { fs.rmdirSync(dest); removedEmpty = true; }
    fs.renameSync(stage, dest);
  } catch (error) {
    if (removedEmpty && !fs.existsSync(dest)) fs.mkdirSync(dest);
    throw error;
  } finally {
    if (fs.existsSync(stage)) fs.rmSync(stage, { recursive: true });
  }
}

try {
  let args;
  try {
    args = parseArgs({ allowPositionals: true, options: { view: { type: "string" }, out: { type: "string" }, fill: { type: "boolean" }, svg: { type: "boolean" } } });
    if (args.positionals.length !== 1 || !args.positionals[0]) throw new Error("Give one MODEL.json.");
    if (args.values.out === "" || args.values.view === "") throw new Error("Give a nonempty path for --out and --view.");
  } catch (error) { throw new Error(`${messageOf(error)}\n\n${USAGE}`); }
  const file = args.positionals[0];
  const out = args.values.out ?? file.replace(/\.json$/i, "") + "-chart";
  const dest = destination(out);
  const model = loadModel(file);
  const check = model.kind === "flow" ? checkFlow(model) : model.kind === "sequence" ? checkSequence(model) : checkArchitecture(model);
  const answers = answersOf(model, await loadView(args.values.view));
  const readability = checkReadability(model, answers);
  check.rules = [...check.rules, ...readability.rules];
  check.bugs.push(...readability.bugs);
  check.warnings = readability.warnings;
  if (answers.product !== undefined) {
    check.rules = [...check.rules, "ProductName"];
    check.bugs.push(...checkProduct(model, answers));
  }
  const chart = mermaid(model, answers, check, args.values.fill).replace(/\r\n?/g, "\n");
  const rendering = args.values.svg ? await (await import("./backends/svg/index.ts")).svg(model, answers, check, path.parse(file).name) : undefined;
  if (rendering) check.warnings?.push(...rendering.warnings, ...widthWarnings(rendering.width));
  if (model.kind !== "sequence") {
    if (rendering?.crossings !== undefined) check.warnings?.push(...crossingWarnings(rendering.crossings));
    else check.unchecked.push("Crossings between arrows in the final layout (requires --svg)");
  }
  const text = report(model, answers, check, path.parse(file).name);
  writeFiles(out, dest, chart, text, rendering?.image);
  process.stdout.write(text);
  process.exitCode = check.bugs.length ? 1 : 0;
} catch (error) {
  console.error(messageOf(error));
  process.exitCode = 2;
}
