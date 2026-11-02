import type { ELK, ElkNode } from "elkjs/lib/elk-api.js";
import { tabBox, type Container, type Point } from "./scene.ts";

// Boundary-port dummies stretch the content and can route through the header.
// Lay out real content first and expose ports to its parent. Final routes are
// resolved once all ancestors and the real opposite endpoints are positioned.
export async function layoutHierarchy(root: ElkNode, elk: ELK, containers: Container[]): Promise<ElkNode> {
  const children: ElkNode[] = [];
  for (const child of root.children ?? []) children.push(child.children
    ? await layoutHierarchy(child, elk, containers) : child);
  const ports = new Map((root.ports ?? []).map((port) => [port.id, port]));
  const boundaryEdges = (root.edges ?? []).filter((edge) => [...edge.sources, ...edge.targets].some((id) => ports.has(id)));
  const graph: ElkNode = { ...root,
    children: children.map((child) => child.children ? { id: child.id, width: child.width, height: child.height,
      ports: child.ports, layoutOptions: { "elk.portConstraints": "FIXED_POS" } } : child),
    ports: [], edges: root.edges?.filter((edge) => !boundaryEdges.includes(edge)),
  };
  const zone = containers.find((zone) => zone.id === root.id);
  if (zone && children.length) { delete graph.width; delete graph.height; }
  const placed = await elk.layout(graph);
  if (zone) placed.width = Math.max(placed.width ?? 0, tabBox(zone).width + 48);
  const northCount = [...ports.values()].filter((port) => port.layoutOptions?.["elk.port.side"] === "NORTH").length;
  if (zone && northCount && placed.children?.length) {
    // Keep the whole port envelope beyond the tab. Clamping individual ports
    // would merge ordered lanes and force paired exchanges to bend or cross.
    const firstCenter = Math.min(...placed.children.map((child) => (child.x ?? 0) + (child.width ?? 0) / 2));
    const shift = Math.max(0, tabBox(zone).width + 16 + (northCount - 1) * 16 - firstCenter);
    for (const child of placed.children) child.x = (child.x ?? 0) + shift;
    for (const edge of placed.edges ?? []) for (const label of edge.labels ?? []) label.x = (label.x ?? 0) + shift;
    placed.width = (placed.width ?? 0) + shift;
  }
  placed.children = (placed.children ?? []).map((child) => {
    const content = children.find((node) => node.id === child.id);
    return content?.children ? { ...content, x: child.x, y: child.y } : child;
  });
  const attachment = (id: string, fraction: number, side: string): Point => {
    for (const child of placed.children ?? []) {
      if (child.id === id) return side === "WEST" || side === "EAST"
        ? { x: (child.x ?? 0) + (side === "EAST" ? child.width ?? 0 : 0), y: (child.y ?? 0) + (child.height ?? 0) * fraction }
        : { x: (child.x ?? 0) + (child.width ?? 0) * fraction, y: (child.y ?? 0) + (side === "NORTH" ? 0 : child.height ?? 0) };
      const port = child.ports?.find((port) => port.id === id);
      if (port) return { x: (child.x ?? 0) + (port.x ?? 0), y: (child.y ?? 0) + (port.y ?? 0) };
    }
    throw new Error("Missing endpoint for a zone boundary route.");
  };
  for (const edge of boundaryEdges) {
    const incoming = ports.has(edge.sources[0]);
    const port = ports.get(incoming ? edge.sources[0] : edge.targets[0]);
    if (!port) continue;
    const endpoint = incoming ? edge.targets[0] : edge.sources[0];
    let side = port.layoutOptions?.["elk.port.side"] ?? "EAST";
    const siblings = boundaryEdges.filter((other) => {
      const otherIncoming = ports.has(other.sources[0]);
      const otherPort = ports.get(otherIncoming ? other.sources[0] : other.targets[0]);
      return (otherIncoming ? other.targets[0] : other.sources[0]) === endpoint && otherPort?.layoutOptions?.["elk.port.side"] === side;
    });
    const fraction = (siblings.indexOf(edge) + 1) / (siblings.length + 1);
    const width = placed.width ?? 0, height = placed.height ?? 0;
    const tab = zone ? tabBox(zone) : { width: 0, height: 0 };
    if (side === "NORTH" && tab.width + 16 > width - 8) side = "EAST";
    const inside = attachment(endpoint, fraction, side);
    const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));
    const boundary = side === "WEST" || side === "EAST"
      ? { x: side === "WEST" ? 0 : width, y: clamp(inside.y, tab.height + 16, height - 8) }
      : side === "NORTH" ? { x: clamp(inside.x, tab.width + 16, width - 8), y: 0 }
      : { x: clamp(inside.x, 8, width - 8), y: height };
    (placed.ports ??= []).push({ ...port, ...boundary, layoutOptions: { ...port.layoutOptions, "elk.port.side": side } });
    (placed.edges ??= []).push({ ...edge, container: root.id });
  }
  placed.layoutOptions = { ...placed.layoutOptions, "elk.portConstraints": "FIXED_POS" };
  return placed;
}
