import { fontSize, textBlock, widthBudget, type TextBlock } from "./text.ts";
import { tabBox, type Box, type Container, type Label, type Point, type Scene, type SvgEdge, type SvgNode } from "./scene.ts";
import { style } from "./style.ts";
import { canvasObstacles, routeTextObstacles } from "./obstacles.ts";
import { warnRouteGoals } from "./route-layout.ts";

export const number = (value: number) => (Math.abs(value) < 0.005 ? 0 : value).toFixed(2);
export const xml = (text: string) => text.replace(/[^\u0009\u000a\u000d\u0020-\ud7ff\ue000-\ufffd\u{10000}-\u{10ffff}]/gu, "\ufffd")
  .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
const boxData = (box: Box) => [box.x, box.y, box.width, box.height].map(number).join(" ");
const rect = (box: Box, cls: string, extra = "") => `<rect class="${cls}" x="${number(box.x)}" y="${number(box.y)}" width="${number(box.width)}" height="${number(box.height)}"${extra}/>`;
const pair = (p: Point) => `${number(p.x)},${number(p.y)}`;
const text = (block: TextBlock, x: number, y: number, cls: string) => {
  const box = { x: x - (cls.split(" ").includes("center") ? block.width / 2 : 0), y, width: block.width, height: block.height };
  return `<text class="${cls}" data-text="${boxData(box)}">${block.lines.map((line, index) => `<tspan x="${number(x)}" y="${number(y + block.fontSize + index * block.lineHeight)}" font-weight="${block.weights[index]}">${xml(line)}</tspan>`).join("")}</text>`;
};
const centeredText = (label: { text: TextBlock; box: Box }, cls = "") => text(label.text, label.box.x + label.box.width / 2, label.box.y + (label.box.height - label.text.height) / 2, `center ${cls}`.trim());

function node(node: SvgNode) {
  const { x, y, width: w, height: h } = node.box;
  let shape: string;
  switch (node.shape) {
    case "decision": shape = `<polygon class="shape" points="${[{ x: x + w / 2, y }, { x: x + w, y: y + h / 2 }, { x: x + w / 2, y: y + h }, { x, y: y + h / 2 }].map(pair).join(" ")}"/>`; break;
    case "store": {
      const r = 8;
      shape = `<path class="shape" d="M ${pair({ x, y: y + r })} A ${number(w / 2)},${number(r)} 0 0 1 ${pair({ x: x + w, y: y + r })} L ${pair({ x: x + w, y: y + h - r })} A ${number(w / 2)},${number(r)} 0 0 1 ${pair({ x, y: y + h - r })} Z M ${pair({ x, y: y + r })} A ${number(w / 2)},${number(r)} 0 0 0 ${pair({ x: x + w, y: y + r })}"/>`;
      break;
    }
    case "terminal": shape = rect(node.box, "shape", ` rx="${number(h / 2)}"`); break;
    default: shape = rect(node.box, "shape");
  }
  return `<g id="node-${node.id}" class="node ${node.shape} ${node.classes.join(" ")}" data-node="${boxData(node.box)}">${shape}${centeredText(node)}</g>`;
}

// Round just the bends; ELK's underlying sections stay orthogonal.
export function roundedPath(points: Point[]): string {
  if (!points.length) return "";
  let d = `M ${pair(points[0])}`;
  for (let i = 1; i < points.length - 1; i++) {
    const a = points[i - 1], b = points[i], c = points[i + 1];
    const before = Math.hypot(b.x - a.x, b.y - a.y), after = Math.hypot(c.x - b.x, c.y - b.y);
    const r = Math.min(4, before / 2, after / 2);
    if (!r) continue;
    const p = { x: b.x + (a.x - b.x) * r / before, y: b.y + (a.y - b.y) * r / before };
    const q = { x: b.x + (c.x - b.x) * r / after, y: b.y + (c.y - b.y) * r / after };
    d += ` L ${pair(p)} Q ${pair(b)} ${pair(q)}`;
  }
  return `${d} L ${pair(points.at(-1) ?? points[0])}`;
}

function head(tip: Point, previous: Point, kind: SvgEdge["head"]) {
  const length = Math.hypot(tip.x - previous.x, tip.y - previous.y);
  if (!length) return "";
  const dx = (tip.x - previous.x) / length, dy = (tip.y - previous.y) / length;
  const left = { x: tip.x - dx * 10 - dy * 4, y: tip.y - dy * 10 + dx * 4 };
  const right = { x: tip.x - dx * 10 + dy * 4, y: tip.y - dy * 10 - dx * 4 };
  if (kind === "lost") return `<path class="lost" d="M ${pair({ x: tip.x - 5, y: tip.y - 5 })} L ${pair({ x: tip.x + 5, y: tip.y + 5 })} M ${pair({ x: tip.x + 5, y: tip.y - 5 })} L ${pair({ x: tip.x - 5, y: tip.y + 5 })}"/>`;
  return kind === "open" ? `<path class="arrow-open" d="M ${pair(left)} L ${pair(tip)} L ${pair(right)}"/>`
    : `<polygon class="arrow-filled" points="${[tip, left, right].map(pair).join(" ")}"/>`;
}

function edge(edge: SvgEdge) {
  const sections = edge.sections.map((points, index) => {
    const first = points[0], second = points[1], end = points.at(-1), before = points.at(-2);
    return `<path id="${edge.id}-s${index}" class="edge" data-points="${points.map(pair).join(" ")}" d="${roundedPath(points)}"/>`
      + (end && before && index === edge.sections.length - 1 ? head(end, before, edge.head) : "")
      + (edge.both && first && second && index === 0 ? head(first, second, "filled") : "");
  }).join("");
  return `<g id="edge-${edge.id}" class="edge-group${edge.dashed ? " dashed" : ""}${edge.broken ? " trust-break" : ""}"${edge.source ? ` data-source="${edge.source}" data-target="${edge.target}"` : ""}>${sections}</g>`;
}

function container(zone: Container) {
  const { box } = zone;
  const lockX = box.x + 12, lockY = box.y + (zone.headerHeight - 14) / 2;
  const lock = zone.untrusted ? `<path class="lock" d="M ${pair({ x: lockX + 2, y: lockY + 7 })} v -3 a 3,3 0 0 1 6,0 v 3"/><rect class="lock-body" x="${number(lockX)}" y="${number(lockY + 6)}" width="10.00" height="8.00"/>` : "";
  return `<g id="container-${zone.id}" class="container${zone.untrusted ? " untrusted" : ""}${zone.sequence ? " group" : ""} ${zone.classes.join(" ")}" data-container="${boxData(box)}" data-tab="${boxData(tabBox(zone))}">`
    + rect(box, "container-body") + rect(tabBox(zone), "container-header") + lock
    + (zone.ports ?? []).map((port) => `<circle data-port="${xml(port.edge)} ${port.incoming ? "in" : "out"} ${port.side} ${pair(port.point)}" cx="${number(port.point.x)}" cy="${number(port.point.y)}" r="0.00"/>`).join("")
    + text(zone.text, box.x + (zone.untrusted ? 30 : 12), box.y + (zone.headerHeight - zone.text.height) / 2, "header") + "</g>";
}

function pill(label: Label) {
  return `<g id="label-${label.id}" data-pill="${boxData(label.box)}"${label.onRoute ? ' data-on-route="true"' : ""}>${rect(label.box, "pill", ` rx="4.00"${label.onRoute ? ' style="fill:#fff"' : ""}`)}${centeredText(label, "edge-label")}</g>`;
}

function note(note: Scene["notes"][number]) {
  const { x, y, width: w, height: h } = note.box;
  return `<g id="note-${note.id}" class="note${note.broken ? " break-note" : ""}" data-note="${boxData(note.box)}"><path class="note-shape" d="M ${pair({ x, y })} H ${number(x + w - 10)} L ${pair({ x: x + w, y: y + 10 })} V ${number(y + h)} H ${number(x)} Z M ${pair({ x: x + w - 10, y })} V ${number(y + 10)} H ${number(x + w)}"/>${centeredText(note)}</g>`;
}

export function canvasLayout(scene: Scene, title: string, entries: [string, string][]) {
  const legendRows = entries.map(([label, cls]) => ({ text: textBlock(label, 260, fontSize.legend), cls }));
  const legendWidth = entries.length ? Math.max(140, ...legendRows.map((row) => row.text.width + 52)) : 0;
  const legendHeight = entries.length ? 34 + legendRows.reduce((sum, row) => sum + Math.max(24, row.text.height + 10), 0) + 6 : 0;
  const titleText = textBlock(title, Math.max(260, Math.min(scene.width, widthBudget - 48 - (legendWidth ? legendWidth + 24 : 0))), fontSize.title, 700);
  const width = Math.max(scene.width + 48, titleText.width + (legendWidth ? legendWidth + 24 : 0) + 48);
  const diagramY = 24 + Math.max(titleText.height, legendHeight) + 24;
  const height = diagramY + scene.height + 24;
  return { legendRows, legendWidth, legendHeight, titleText, width, diagramY, height };
}

export function render(scene: Scene, title: string, entries: [string, string][]) {
  const { legendRows, legendWidth, legendHeight, titleText, width, diagramY, height } = canvasLayout(scene, title, entries);
  routeTextObstacles(scene, canvasObstacles(titleText, diagramY, width, legendWidth, legendHeight));
  warnRouteGoals(scene);
  const lines = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${number(width)}" height="${number(height)}" viewBox="0.00 0.00 ${number(width)} ${number(height)}" role="img" aria-labelledby="chart-title">`,
    `<title id="chart-title">${xml(title)}</title>`, `<style>${style}</style>`,
    rect({ x: 0, y: 0, width, height }, "canvas"), text(titleText, 24, 24, "title"),
  ];
  if (entries.length) {
    const box = { x: width - 24 - legendWidth, y: 24, width: legendWidth, height: legendHeight };
    lines.push(`<g id="legend" data-legend="${boxData(box)}">`, rect(box, "legend-body"), text(textBlock("Legend", 260, fontSize.legend, 700), box.x + 12, box.y + 8, "legend-label legend-heading"));
    let y = box.y + 34;
    for (const row of legendRows) {
      lines.push(rect({ x: box.x + 12, y: y + (row.text.height - 12) / 2, width: 16, height: 12 }, `swatch ${row.cls}`), text(row.text, box.x + 40, y, "legend-label"));
      y += Math.max(24, row.text.height + 10);
    }
    lines.push("</g>");
  }
  lines.push(`<g id="diagram" transform="translate(24.00 ${number(diagramY)})" data-diagram="${boxData({ x: 24, y: diagramY, width: scene.width, height: scene.height })}">`);
  lines.push(...[...scene.containers].sort((a, b) => b.box.width * b.box.height - a.box.width * a.box.height).map(container));
  lines.push(...scene.bands.map((box) => rect(box, "break-band")));
  lines.push(...scene.lifelines.map((line) => `<line class="lifeline" x1="${number(line.x)}" x2="${number(line.x)}" y1="${number(line.top)}" y2="${number(line.bottom)}"/>`));
  for (const frame of scene.frames) {
    const { x, y, width: w } = frame.box;
    lines.push(`<g id="frame-${frame.id}">`, rect(frame.box, "frame"), `<path class="frame-tab" d="M ${pair({ x, y })} h 46.00 v 18.00 l -8.00,8.00 h -38.00 Z"/>`, text(textBlock("par", 40, fontSize.header, 700), x + 9, y + 4, "header"));
    for (const [index, branch] of frame.branches.entries()) {
      if (index) lines.push(`<line class="branch-divider" x1="${number(x)}" x2="${number(x + w)}" y1="${number(branch.y - 6)}" y2="${number(branch.y - 6)}"/>`);
      lines.push(text(branch.text, x + 12, branch.y, "branch-label"));
    }
    lines.push("</g>");
  }
  lines.push(...scene.edges.map(edge), ...scene.nodes.map(node), ...scene.notes.map(note), ...scene.edges.flatMap((edge) => edge.labels.map(pill)), "</g>", "</svg>");
  return lines.join("\n") + "\n";
}
