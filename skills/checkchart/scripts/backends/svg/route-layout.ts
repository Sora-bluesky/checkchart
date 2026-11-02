import type { Direction } from "../../ir.ts";
import { edgePairs, routeGraphLines, tightenGraphZones } from "./line-routing.ts";
import { fitEdgeLabels, recoverEdgeLabelSpace, reserveCrossZoneLabelSpace } from "./labels.ts";
import { layoutCompromise, type Scene, type SvgEdge } from "./scene.ts";
import { countCrossings } from "./crossings.ts";

function detour(edge: SvgEdge) {
  const points = edge.sections.flat();
  const length = points.slice(1).reduce((sum, p, i) => sum + Math.abs(p.x - points[i].x) + Math.abs(p.y - points[i].y), 0);
  const a = points[0], b = points.at(-1)!;
  const direct = Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
  return direct ? length / direct : Infinity;
}

const decisionLoop = (scene: Scene, edge: SvgEdge) => edge.source === edge.target && scene.nodes.some((node) => node.id === edge.source && node.shape === "decision");

export function routeMetrics(scene: Scene) {
  const bends = scene.edges.reduce((sum, edge) => {
    const points = edge.sections.flat().filter((p, i, all) => !i || p.x !== all[i - 1].x || p.y !== all[i - 1].y);
    return sum + points.slice(1, -1).filter((p, i) =>
      !((points[i].x === p.x && p.x === points[i + 2].x || points[i].y === p.y && p.y === points[i + 2].y) &&
        (p.x - points[i].x) * (points[i + 2].x - p.x) + (p.y - points[i].y) * (points[i + 2].y - p.y) > 0)).length;
  }, 0);
  return { bends, crossings: countCrossings(scene.edges), detour: Math.max(1, ...scene.edges.filter((edge) => !decisionLoop(scene, edge)).map(detour)) };
}

// Report the geometry actually emitted, including any final text detour.
// Search relaxations alone are not evidence that the finished line misses a goal.
export function warnRouteGoals(scene: Scene) {
  for (const edge of scene.edges) {
    const points = edge.sections.flat().filter((p, i, all) => !i || p.x !== all[i - 1].x || p.y !== all[i - 1].y)
      .filter((p, i, all) => !i || i === all.length - 1 ||
        !(all[i - 1].x === p.x && p.x === all[i + 1].x || all[i - 1].y === p.y && p.y === all[i + 1].y));
    if (points.length > 2 && points.slice(1).some((p, i) =>
      Math.abs(p.x - points[i].x) + Math.abs(p.y - points[i].y) < (i === 0 || i === points.length - 2 ? 24 : 16) - 0.01)) {
      layoutCompromise(scene, edge.id, "route misses minimum jog length (16px) or normal lead (24px)");
    }
    if (points.slice(1).some((p, i) => scene.containers.filter((zone) => !zone.sequence).some(({ box }) => {
      const a = points[i], v = a.x === p.x;
      const overlap = Math.min(Math.max(v ? a.y : a.x, v ? p.y : p.x), v ? box.y + box.height : box.x + box.width) -
        Math.max(Math.min(v ? a.y : a.x, v ? p.y : p.x), v ? box.y : box.x);
      return overlap > 0.01 && (v ? [box.x, box.x + box.width] : [box.y, box.y + box.height])
        .some((border) => Math.abs((v ? p.x : p.y) - border) < 12 - 0.01);
    }))) layoutCompromise(scene, edge.id, "route misses border clearance (12px)");
    if (!decisionLoop(scene, edge) && detour(edge) > 1.8 + 1e-8) layoutCompromise(scene, edge.id, "route exceeds the 1.8 detour limit");
  }
  for (const pair of edgePairs(scene.edges)) {
    if (scene.nodes.some((node) => node.shape === "decision" && [pair[0].source, pair[0].target].includes(node.id))) continue;
    const paths = pair.map((edge) => edge.sections.flat().filter((p, i, all) => !i || p.x !== all[i - 1].x || p.y !== all[i - 1].y));
    const axis = paths[0][0].x === paths[0][1].x ? "x" : "y";
    const lanes = paths.map((points) => points[0][axis]).sort((a, b) => a - b);
    for (const [i, points] of paths.entries()) if (points.some((p) => Math.abs(p[axis] - points[0][axis]) > 0.01)) {
      layoutCompromise(scene, pair[i].id, "paired lanes cannot retain a straight corridor");
    }
    if (lanes.some((value, i) => i > 0 && value - lanes[i - 1] < 24 - 0.01)) {
      for (const edge of pair) layoutCompromise(scene, edge.id, "paired lanes miss minimum spacing (24px)");
    }
  }
}

// Port movement and facing Ls precede spacing, detours and border relaxation.
export function routeLayout(base: Scene, direction: Direction): Scene {
  let scene = structuredClone(base);
  reserveCrossZoneLabelSpace(scene, direction);
  // Keep gap labels in their shared parent's content before unused padding is
  // released. Labels inside an endpoint zone must not preserve stale padding.
  routeGraphLines(scene, direction, "zone-gaps");
  tightenGraphZones(scene);
  routeGraphLines(scene, direction, true);
  tightenGraphZones(scene);
  const expanded = recoverEdgeLabelSpace(scene, direction);
  if (expanded !== scene) {
    scene = expanded;
    tightenGraphZones(scene);
  }
  fitEdgeLabels(scene);
  return scene;
}
