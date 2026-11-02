import type { TextBlock } from "./text.ts";
import type { Warning } from "../../ir.ts";

export type Point = { x: number; y: number };
export type Box = Point & { width: number; height: number };
export type PortSide = "NORTH" | "SOUTH" | "WEST" | "EAST";
export type BoundaryPort = { id: string; edge: string; side: PortSide; point: Point; incoming: boolean };
export type Shape = "box" | "decision" | "terminal" | "store" | "external";
export type SvgNode = { id: string; box: Box; text: TextBlock; shape: Shape; classes: string[]; parent?: string };
export type Label = { id: string; box: Box; text: TextBlock; onRoute?: boolean };
export type SvgEdge = {
  id: string; sections: Point[][]; dashed: boolean; head: "filled" | "open" | "lost";
  both?: boolean; broken?: boolean; main?: boolean; source?: string; target?: string; labels: Label[];
  sectionOwners?: string[];
};
export type Container = { id: string; box: Box; text: TextBlock; headerHeight: number; untrusted: boolean; classes: string[]; sequence?: boolean; parent?: string; ports?: BoundaryPort[] };
export type Note = Label & { broken?: boolean };
export type Frame = { id: string; box: Box; branches: { y: number; text: TextBlock }[] };
export type Scene = {
  width: number; height: number;
  nodes: SvgNode[]; edges: SvgEdge[]; containers: Container[]; notes: Note[]; frames: Frame[];
  bands: Box[]; lifelines: { x: number; top: number; bottom: number }[];
  warnings: Warning[];
};

export const emptyScene = (): Scene => ({ width: 0, height: 0, nodes: [], edges: [], containers: [], notes: [], frames: [], bands: [], lifelines: [], warnings: [] });
export function layoutCompromise(scene: Scene, edge: string, goal: string) {
  const detail = `${edge} ${goal}`;
  if (!scene.warnings.some((warning) => warning.rule === "LayoutCompromise" && warning.detail === detail)) {
    scene.warnings.push({ rule: "LayoutCompromise", detail });
  }
}
export const overlaps = (a: Box, b: Box, gap = 0) =>
  a.x < b.x + b.width + gap && a.x + a.width + gap > b.x &&
  a.y < b.y + b.height + gap && a.y + a.height + gap > b.y;

export const tabBox = (zone: Container): Box => ({ ...zone.box,
  width: zone.text.width + (zone.untrusted ? 42 : 24), height: zone.headerHeight });
export const nodeTextBox = (node: SvgNode): Box => ({ x: node.box.x + (node.box.width - node.text.width) / 2,
  y: node.box.y + (node.box.height - node.text.height) / 2, width: node.text.width, height: node.text.height });

// ELK routes rectangular boxes. Extend the last straight section to the actual
// diamond, stadium or cylinder outline without changing its axis.
export function onOutline(node: SvgNode, point: Point, neighbor: Point): Point {
  const { x, y, width: w, height: h } = node.box;
  const cx = x + w / 2, cy = y + h / 2;
  // ELK coordinates can differ by floating-point noise along the shared axis.
  // Choose the axis by displacement, then preserve the neighbor's coordinate.
  const vertical = Math.abs(point.x - neighbor.x) < Math.abs(point.y - neighbor.y);
  const p = vertical ? { x: neighbor.x, y: point.y } : { x: point.x, y: neighbor.y };
  if (node.shape === "decision") {
    return vertical
      ? { x: p.x, y: cy + Math.sign(p.y - cy) * h / 2 * (1 - Math.min(1, Math.abs(p.x - cx) / (w / 2))) }
      : { x: cx + Math.sign(p.x - cx) * w / 2 * (1 - Math.min(1, Math.abs(p.y - cy) / (h / 2))), y: p.y };
  }
  if (node.shape === "terminal") {
    const rx = Math.min(h / 2, w / 2), ry = h / 2;
    if (!vertical) {
      const end = p.x < cx ? x + rx : x + w - rx;
      return { x: end + Math.sign(p.x - cx) * rx * Math.sqrt(Math.max(0, 1 - ((p.y - cy) / ry) ** 2)), y: p.y };
    }
    const end = Math.max(x + rx, Math.min(x + w - rx, p.x));
    return { x: p.x, y: cy + Math.sign(p.y - cy) * ry * Math.sqrt(Math.max(0, 1 - ((p.x - end) / rx) ** 2)) };
  }
  if (node.shape === "store") {
    if (vertical) {
      const cap = 8 * Math.sqrt(Math.max(0, 1 - ((p.x - cx) / (w / 2)) ** 2));
      return { x: p.x, y: p.y < cy ? y + 8 - cap : y + h - 8 + cap };
    }
    if (p.y < y + 8 || p.y > y + h - 8) {
      const capY = p.y < cy ? y + 8 : y + h - 8;
      return { x: cx + Math.sign(p.x - cx) * w / 2 * Math.sqrt(Math.max(0, 1 - ((p.y - capY) / 8) ** 2)), y: p.y };
    }
  }
  return p;
}
