import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import type { TestContext } from "node:test";

export const root = fileURLToPath(new URL("../../../../", import.meta.url));
export const cli = fileURLToPath(new URL("../checkchart.ts", import.meta.url));

export function scratch(t: TestContext): string {
  const dir = fs.mkdtempSync(path.join(import.meta.dirname, ".checkchart-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

export function run(file: string, out: string, view?: string, flags: string[] = []) {
  const result = spawnSync(process.execPath, ["--disable-warning=ExperimentalWarning", cli, file, "--out", out, ...(view ? ["--view", view] : []), ...flags], { encoding: "utf8" });
  if (result.error) throw result.error;
  return {
    status: result.status, stdout: result.stdout, stderr: result.stderr, out,
    chart: fs.existsSync(path.join(out, "chart.mmd")) ? fs.readFileSync(path.join(out, "chart.mmd"), "utf8") : "",
    report: fs.existsSync(path.join(out, "report.md")) ? fs.readFileSync(path.join(out, "report.md"), "utf8") : "",
  };
}

export function runModel(t: TestContext, model: unknown, view?: string, flags: string[] = [], withPurpose = false) {
  const dir = scratch(t);
  const file = path.join(dir, "model.json");
  fs.writeFileSync(file, JSON.stringify(model) + "\n", "utf8");
  const viewFile = view === undefined && !withPurpose ? undefined : path.join(dir, "view.mjs");
  if (withPurpose) {
    // Older behavioral tests state the new preconditions without hiding the raw CLI path.
    fs.writeFileSync(path.join(dir, "source.mjs"), view ?? "export {};\n", "utf8");
    const architecture = typeof model === "object" && model !== null && "kind" in model && model.kind === "architecture";
    view = `import * as source from "./source.mjs";
export * from "./source.mjs";
export const title = "title" in source ? source.title : "Workflow";
export const reader = "A maintainer";
export const question = "How does the workflow finish?";
export const step = "step" in source ? source.step : ${architecture ? '() => "Sends a request"' : "undefined"};
`;
  }
  if (viewFile) fs.writeFileSync(viewFile, view ?? "", "utf8");
  return run(file, path.join(dir, "out"), viewFile, flags);
}

export function runModelWithPurpose(t: TestContext, model: unknown, view?: string, flags: string[] = []) {
  return runModel(t, model, view, flags, true);
}

export function fixture(t: TestContext, name: string, flags: string[] = []) {
  const dir = path.join(root, "examples", "broken", name);
  return run(path.join(dir, "model.json"), path.join(scratch(t), "out"), path.join(dir, "view.mjs"), flags);
}

export const simpleFlow = { kind: "flow", nodes: { start: { type: "start" }, done: { type: "end" } }, edges: [{ from: "start", to: "done" }] };
export const simpleSequence = { kind: "sequence", participants: ["screen", "core"], messages: [{ from: "screen", to: "core", type: "signal" }] };
export const simpleArchitecture = { kind: "architecture", zones: {}, components: { screen: {}, core: {} }, connections: [{ from: "screen", to: "core" }] };
