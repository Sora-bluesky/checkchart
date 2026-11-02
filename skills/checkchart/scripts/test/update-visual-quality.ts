import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { root } from "./helpers.ts";
import { assertVisualLimits, assertVisualWidth, measureChart, visualCorpus, type VisualMetrics } from "./visual-quality.ts";

const update = process.argv.includes("--update");
const destination = process.argv.find((arg) => arg.startsWith("--snapshot="))?.slice("--snapshot=".length);
if (!update && !destination) throw new Error("Use --update after inspecting SVGs, or --snapshot=<worktree-relative JSON> to measure without updating.");
fs.mkdirSync(path.join(root, ".tmp"), { recursive: true });
const runDir = fs.mkdtempSync(path.join(root, ".tmp", "visual-quality-"));
const charts: Record<string, VisualMetrics> = {}, details: Record<string, Awaited<ReturnType<typeof measureChart>>> = {};
const baseline = JSON.parse(fs.readFileSync(new URL("./visual-quality-baseline.json", import.meta.url), "utf8"));
const previous = update ? baseline.charts : {};
for (const { id, file } of visualCorpus()) {
  const quality = await measureChart(file, path.join(runDir, id));
  if (update) {
    assertVisualLimits(quality);
    if (id.startsWith("examples/") && !baseline.wideExamples?.[id]) assertVisualWidth(quality);
    if (previous[id]) for (const key of ["totalBends", "crossings", "maxDetourRatio"] as const) {
      assert.ok(quality.metrics[key] <= previous[id][key] + 1e-6, `${id} ${key} worsened; preserve the previous baseline`);
    }
  }
  charts[id] = quality.metrics;
  details[id] = quality;
}
if (process.env.CHECKCHART_PARENT_CHARTS && !update) for (const name of ["archA", "archB", "flow", "seq"]) {
  const quality = await measureChart(path.join(process.env.CHECKCHART_PARENT_CHARTS, name, "model.json"), path.join(runDir, name));
  charts[name] = quality.metrics;
  details[name] = quality;
}
const target = update ? new URL("./visual-quality-baseline.json", import.meta.url) : path.resolve(root, destination!);
if (!update && !path.relative(path.join(root, ".tmp"), target as string).startsWith("..") && !path.isAbsolute(path.relative(path.join(root, ".tmp"), target as string))) {
  fs.mkdirSync(path.dirname(target as string), { recursive: true });
} else if (!update) throw new Error("Snapshots must be inside .tmp/ in the worktree.");
fs.writeFileSync(target, JSON.stringify(update ? { version: 1, wideExamples: baseline.wideExamples ?? {}, charts } : { charts, details }, null, 2) + "\n", "utf8");
console.log(update ? "Updated visual quality baseline after hard limits passed." : "Saved local visual measurements.");
