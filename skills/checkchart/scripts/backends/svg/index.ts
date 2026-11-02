import type { Answers, Check, Model, Warning } from "../../ir.ts";
import { graphPresentation } from "../presentation.ts";
import { graphScene } from "./graph.ts";
import { sequenceScene } from "./sequence.ts";
import { canvasLayout, render } from "./render.ts";
import { countCrossings } from "./crossings.ts";

export async function svg(model: Model, answers: Answers, check: Check, modelName: string): Promise<{ image: string; width: number; warnings: Warning[]; crossings?: number }> {
  let module;
  try { module = await import("elkjs/lib/elk.bundled.js"); }
  catch { throw new Error("Run npm install in <skill dir>/scripts to draw SVG."); }
  // The bundled build runs in-process; it creates no worker thread to terminate.
  const scene = model.kind === "sequence" ? sequenceScene(model, answers, check) : await graphScene(model, answers, check, new module.default());
  // Mermaid sequences have no legend: participant group bands carry the key.
  const entries = model.kind === "sequence" ? [] : graphPresentation(model, answers, check).legend;
  const title = answers.title || modelName;
  return { image: render(scene, title, entries, answers.locale), width: canvasLayout(scene, title, entries).width, warnings: scene.warnings,
    ...(model.kind === "sequence" ? {} : { crossings: countCrossings(scene.edges) }) };
}
