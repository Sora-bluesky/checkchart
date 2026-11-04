import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { root, run, scratch } from "./helpers.ts";

for (const kind of ["flow", "sequence", "architecture", "warnings"]) test(`${kind} example matches both golden files byte for byte`, (t) => {
  const example = path.join(root, "examples", kind);
  const result = run(path.join(example, "model.json"), path.join(scratch(t), "out"), path.join(example, "view.mjs"));
  assert.equal(result.status, 0, result.stderr || result.report);
  assert.equal(result.stdout, result.report);
  for (const name of ["chart.mmd", "report.md"]) {
    assert.deepEqual(fs.readFileSync(path.join(result.out, name)), fs.readFileSync(path.join(example, name)));
  }
});

for (const [name, status] of [["ja/connections", 0], ["ja/architecture", 1], ["unchecked-input", 1]] as const) test(`${name} README figure matches its golden files byte for byte`, (t) => {
  const example = path.join(root, "examples", name);
  const result = run(path.join(example, "model.json"), path.join(scratch(t), "out"), path.join(example, "view.mjs"), ["--svg"]);
  assert.equal(result.status, status, result.stderr || result.report);
  for (const file of ["chart.svg", "chart.mmd", "report.md"]) {
    assert.deepEqual(fs.readFileSync(path.join(result.out, file)), fs.readFileSync(path.join(example, file)), file);
  }
});
