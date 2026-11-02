import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { root } from "./helpers.ts";

test("the marketplace resolves checkchart@checkchart to the local plugin", () => {
  const marketplace = JSON.parse(fs.readFileSync(path.join(root, ".claude-plugin/marketplace.json"), "utf8"));
  assert.equal(marketplace.name, "checkchart");
  assert.equal(marketplace.plugins.length, 1);
  const plugin = marketplace.plugins[0];
  assert.equal(plugin.name, "checkchart");
  assert.equal(plugin.source, "./");
  assert.equal(typeof plugin.description, "string");
  assert.ok(plugin.description.trim());
  const manifest = JSON.parse(fs.readFileSync(path.join(root, plugin.source, ".claude-plugin/plugin.json"), "utf8"));
  assert.equal(manifest.name, plugin.name);
  assert.deepEqual(marketplace.owner, manifest.author);
  assert.ok(fs.existsSync(path.join(root, plugin.source, "skills/checkchart/SKILL.md")));
});
