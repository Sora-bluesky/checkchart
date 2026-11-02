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
