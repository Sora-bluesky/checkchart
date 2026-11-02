import assert from "node:assert/strict";
import { zoneParents } from "../backends/presentation.ts";
import type { Box, Point } from "../backends/svg/scene.ts";
import type { Model } from "../ir.ts";

const boxOf = (value: string): Box => {
  const [x, y, width, height] = value.split(" ").map(Number);
  assert.ok([x, y, width, height].every(Number.isFinite), "invalid SVG bounds");
  return { x, y, width, height };
};
const overlaps = (a: Box, b: Box, tolerance: number) =>
  Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) > tolerance &&
  Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) > tolerance;

function clippedSegment(a: Point, b: Point, box: Box): Box | undefined {
  const x = Math.max(Math.min(a.x, b.x), box.x), y = Math.max(Math.min(a.y, b.y), box.y);
  const right = Math.min(Math.max(a.x, b.x), box.x + box.width);
  const bottom = Math.min(Math.max(a.y, b.y), box.y + box.height);
  return right >= x && bottom >= y ? { x, y, width: right - x, height: bottom - y } : undefined;
}

export function layoutQuality(svg: string, model: Model, tolerance = 2) {
  const nodes = new Map([...svg.matchAll(/id="node-([^"]+)"[^>]* data-node="([^"]+)"/g)]
    .map((match) => [match[1], boxOf(match[2])]));
  const containers = new Map([...svg.matchAll(/id="container-([^"]+)"[^>]* data-container="([^"]+)"/g)]
    .map((match) => [match[1], boxOf(match[2])]));
  const notes = [...svg.matchAll(/ data-note="([^"]+)"/g)].map((match) => boxOf(match[1]));
  const labels = [...svg.matchAll(/id="label-([^"]+)" data-pill="([^"]+)"([^>]*)>/g)]
    .map((match) => ({ id: match[1], edge: match[1].replace(/-label$/, ""), box: boxOf(match[2]), onRoute: match[3].includes('data-on-route="true"') }));
  const edges = [...svg.matchAll(/<g id="edge-([^"]+)"[^>]*>(.*?)<\/g>/g)].map((match) => ({
    id: match[1],
    sections: [...match[2].matchAll(/ data-points="([^"]+)"/g)].map((section) => section[1].split(" ").map((point) => {
      const [x, y] = point.split(",").map(Number);
      assert.ok(Number.isFinite(x) && Number.isFinite(y), "invalid SVG point");
      return { x, y };
    })),
  }));
  const collisions: string[] = [];
  const routeGaps: string[] = [];
  for (const edge of edges) for (let i = 1; i < edge.sections.length; i++) {
    const end = edge.sections[i - 1].at(-1), start = edge.sections[i][0];
    if (!end || !start || Math.hypot(end.x - start.x, end.y - start.y) > 0.02) routeGaps.push(`${edge.id} section ${i}`);
  }
  for (const [index, label] of labels.entries()) {
    for (const other of labels.slice(index + 1)) if (overlaps(label.box, other.box, tolerance)) collisions.push(`${label.id} / ${other.id}`);
    for (const [id, box] of [...nodes, ...notes.map((box, i): [string, Box] => [`note-${i}`, box])]) {
      if (overlaps(label.box, box, tolerance)) collisions.push(`${label.id} / ${id}`);
    }
    const interior = { x: label.box.x + tolerance, y: label.box.y + tolerance,
      width: label.box.width - 2 * tolerance, height: label.box.height - 2 * tolerance };
    for (const edge of edges) if (edge.id !== label.edge) {
      for (const section of edge.sections) for (let i = 1; i < section.length; i++) {
        const clip = clippedSegment(section[i - 1], section[i], interior);
        if (clip && (clip.width > 0 || clip.height > 0)) collisions.push(`${label.id} / ${edge.id} segment ${i}`);
      }
    }
  }
  const diagram = svg.match(/ data-diagram="([^"]+)"/);
  const offset = diagram ? boxOf(diagram[1]) : { x: 0, y: 0 };
  const textBoxes = [...svg.matchAll(/<g id="((?:node|container|frame)-[^"]+)"([^>]*)>(.*?)<\/g>/g)]
    .flatMap((group) => {
      const tab = group[2].match(/ data-tab="([^"]+)"/);
      return tab ? [{ id: group[1], box: boxOf(tab[1]) }]
        : [...group[3].matchAll(/ data-text="([^"]+)"/g)].map((match) => ({ id: group[1], box: boxOf(match[1]) }));
    });
  for (const label of labels) textBoxes.push({ id: `label-${label.id}`, box: label.box });
  for (const [index, box] of notes.entries()) textBoxes.push({ id: `note-${index}`, box });
  for (const title of svg.matchAll(/<text class="title" data-text="([^"]+)"/g)) {
    const box = boxOf(title[1]);
    textBoxes.push({ id: "title", box: { ...box, x: box.x - offset.x, y: box.y - offset.y } });
  }
  for (const legend of svg.matchAll(/ data-legend="([^"]+)"/g)) {
    const box = boxOf(legend[1]);
    textBoxes.push({ id: "legend", box: { ...box, x: box.x - offset.x, y: box.y - offset.y } });
  }
  const textCollisions: string[] = [];
  for (const edge of edges) for (const section of edge.sections) for (let i = 1; i < section.length; i++) {
    for (const { id, box } of textBoxes) {
      if (labels.some((label) => label.onRoute && label.edge === edge.id && id === `label-${label.id}`)) continue;
      const clip = clippedSegment(section[i - 1], section[i], { x: box.x + 1, y: box.y + 1, width: box.width - 2, height: box.height - 2 });
      if (clip && (clip.width > 0 || clip.height > 0)) textCollisions.push(`${edge.id} / ${id} segment ${i}`);
    }
  }
  const { borderViolations, portViolations, ports } = boundaryQuality(svg, model, edges, containers);
  const zones: { id: string; left: number; right: number; bottom: number }[] = [];
  const containmentViolations: string[] = [];
  if (model.kind === "architecture") {
    const parents = zoneParents(model), zoneIds = Object.keys(model.zones);
    const componentIds = Object.keys(model.components);
    const inside = (componentId: string, zoneId: string) => {
      for (let id = model.components[componentId]?.zone; id !== undefined; id = parents.get(id)) if (id === zoneId) return true;
      return false;
    };
    for (const [index, id] of zoneIds.entries()) {
      const zone = containers.get(`z${index}`);
      assert.ok(zone, `missing zone z${index}`);
      const group = svg.match(new RegExp(`<g id="container-z${index}"([^>]*)>`));
      const tabValue = group?.[1].match(/ data-tab="([^"]+)"/)?.[1];
      const tab = tabValue ? boxOf(tabValue) : { ...zone, height: 0 };
      const enclosed = (box: Box) => box.x >= zone.x + 8 - 0.02 && box.x + box.width <= zone.x + zone.width - 8 + 0.02 &&
        box.y >= tab.y + tab.height + 8 - 0.02 && box.y + box.height <= zone.y + zone.height - 8 + 0.02;
      for (const [i, component] of componentIds.entries()) {
        const node = nodes.get(`n${i}`);
        if (!node) continue;
        if (inside(component, id) ? !enclosed(node) : overlaps(node, zone, 1)) containmentViolations.push(`n${i} / z${index}`);
      }
      for (const [i, child] of zoneIds.entries()) if (parents.get(child) === id && containers.has(`z${i}`) && !enclosed(containers.get(`z${i}`)!)) {
        containmentViolations.push(`z${i} / z${index}`);
      }
      const content = componentIds.flatMap((component, i) => model.components[component].zone === id && nodes.has(`n${i}`) ? [nodes.get(`n${i}`)!] : []);
      for (const [i, child] of zoneIds.entries()) if (parents.get(child) === id && containers.has(`z${i}`)) content.push(containers.get(`z${i}`)!);
      for (const [i, connection] of model.connections.entries()) if (inside(connection.from, id)) {
        const edge = edges.find((edge) => edge.id === `e${i}`);
        for (const label of labels.filter((label) => label.edge === `e${i}`)) {
          if (label.box.x >= zone.x && label.box.x + label.box.width <= zone.x + zone.width &&
              label.box.y >= zone.y && label.box.y + label.box.height <= zone.y + zone.height) content.push(label.box);
        }
        for (const section of edge?.sections ?? []) for (let p = 1; p < section.length; p++) {
          const clipped = clippedSegment(section[p - 1], section[p], zone);
          if (clipped) content.push(clipped);
        }
      }
      // The tab is occupied width too: its required 48px reserve can be wider
      // than the descendants. Do not call that measured text space loose padding.
      if (content.length) zones.push({ id: `z${index}`, left: Math.min(zone.x + 40, ...content.map((box) => box.x)) - zone.x,
        right: zone.x + zone.width - Math.max(tab.x + tab.width + 8, ...content.map((box) => box.x + box.width)),
        bottom: zone.y + zone.height - Math.max(...content.map((box) => box.y + box.height)) });
    }
  }
  const canvas = svg.match(/<svg[^>]* width="([^"]+)" height="([^"]+)"/);
  return { nodes: nodes.size, edges: edges.length, labels: labels.length, zones, collisions, routeGaps, textBoxes: textBoxes.length, textCollisions,
    borderViolations, portViolations, ports, containmentViolations, width: canvas ? Number(canvas[1]) : 0, height: canvas ? Number(canvas[2]) : 0,
    maxZoneSlack: Math.max(0, ...zones.flatMap((zone) => [zone.left, zone.right, zone.bottom])) };
}

export function assertLayoutQuality(svg: string, model: Model) {
  const quality = layoutQuality(svg, model);
  assert.deepEqual(quality.collisions, [], "edge labels overlap labels, nodes or other edges");
  assert.deepEqual(quality.routeGaps, [], "edge sections detach at zone boundaries");
  assert.deepEqual(quality.textCollisions, [], "edges cross zone header text, node text or the legend");
  assert.deepEqual(quality.borderViolations, [], "edges must cross container borders perpendicularly");
  assert.deepEqual(quality.portViolations, [], "zone crossings must use direction-facing ports outside tabs");
  assert.deepEqual(quality.containmentViolations, [], "components and nested zones must remain inside their own ancestors");
  for (const zone of quality.zones) assert.ok(Math.max(zone.left, zone.right, zone.bottom) <= 40.02,
    `zone is loose: ${JSON.stringify(zone)}`);
  return quality;
}

function boundaryQuality(svg: string, model: Model, edges: { id: string; sections: Point[][] }[], containers: Map<string, Box>) {
  const borderViolations: string[] = [], portViolations: string[] = [];
  const groups = [...svg.matchAll(/<g id="container-([^"]+)"([^>]*)>(.*?)<\/g>/g)];
  const nodes = new Map([...svg.matchAll(/id="node-([^"]+)"[^>]* data-node="([^"]+)"/g)].map((match) => [match[1], boxOf(match[2])]));
  const ports = groups.flatMap((group) => [...group[3].matchAll(/ data-port="(\S+) (in|out) (NORTH|SOUTH|WEST|EAST) ([^,]+),([^"]+)"/g)]
    .map((match) => ({ zone: group[1], edge: match[1], incoming: match[2] === "in", side: match[3], x: Number(match[4]), y: Number(match[5]) })));
  const near = (a: number, b: number) => Math.abs(a - b) < 0.03;
  const between = (n: number, a: number, b: number) => n >= Math.min(a, b) - 0.02 && n <= Math.max(a, b) + 0.02;
  for (const edge of edges) for (const [id, box] of containers) {
    const hits: Point[] = [];
    for (const section of edge.sections) for (let i = 1; i < section.length; i++) {
      const a = section[i - 1], b = section[i];
      if (!near(a.x, b.x) && !near(a.y, b.y)) borderViolations.push(`${edge.id} diagonal segment ${i}`);
      const vertical = near(a.x, b.x);
      const tangent = vertical ? (near(a.x, box.x) || near(a.x, box.x + box.width)) &&
        Math.min(Math.max(a.y, b.y), box.y + box.height) - Math.max(Math.min(a.y, b.y), box.y) > 1
        : (near(a.y, box.y) || near(a.y, box.y + box.height)) &&
        Math.min(Math.max(a.x, b.x), box.x + box.width) - Math.max(Math.min(a.x, b.x), box.x) > 1;
      if (tangent) borderViolations.push(`${edge.id} runs along ${id}`);
      if (vertical && between(a.x, box.x, box.x + box.width)) {
        for (const y of [box.y, box.y + box.height]) if (between(y, a.y, b.y)) hits.push({ x: a.x, y });
      } else if (!vertical && between(a.y, box.y, box.y + box.height)) {
        for (const x of [box.x, box.x + box.width]) if (between(x, a.x, b.x)) hits.push({ x, y: a.y });
      }
    }
    if (model.kind === "architecture") for (const hit of hits) {
      if (!ports.some((port) => port.zone === id && port.edge === edge.id && near(port.x, hit.x) && near(port.y, hit.y))) {
        portViolations.push(`${edge.id} crosses ${id} without a port at ${hit.x},${hit.y}`);
      }
    }
  }
  if (model.kind === "architecture") {
    const parents = zoneParents(model);
    const inside = (component: string, zone: string) => {
      for (let id = model.components[component]?.zone; id !== undefined; id = parents.get(id)) if (id === zone) return true;
      return false;
    };
    for (const [index, zone] of Object.keys(model.zones).entries()) {
      const id = `z${index}`, box = containers.get(id)!;
      const group = groups.find((group) => group[1] === id);
      const tabValue = group?.[2].match(/ data-tab="([^"]+)"/)?.[1];
      const tab = tabValue ? boxOf(tabValue) : { ...box, height: 0 };
      for (const [i, edge] of model.connections.entries()) {
        if (!edges.some((drawn) => drawn.id === `e${i}`)) continue;
        const from = inside(edge.from, zone), to = inside(edge.to, zone);
        const actual = ports.filter((port) => port.zone === id && port.edge === `e${i}`);
        if (actual.length !== Number(from !== to)) portViolations.push(`e${i} / ${id}: expected ${Number(from !== to)} port, got ${actual.length}`);
        for (const port of actual) {
          // Entry and exit share the face looking toward the outside endpoint.
          // A reply to an upper node leaves through NORTH, just like its input.
          const outside = nodes.get(`n${Object.keys(model.components).indexOf(from ? edge.to : edge.from)}`)!;
          const xSeparate = box.x + box.width <= outside.x || outside.x + outside.width <= box.x;
          const ySeparate = box.y + box.height <= outside.y || outside.y + outside.height <= box.y;
          const vertical = ["LR", "RL"].includes(model.direction) ? !xSeparate && ySeparate : ySeparate || !xSeparate;
          const expected = vertical ? outside.y + outside.height / 2 > box.y + box.height / 2 ? "SOUTH" : "NORTH"
            : outside.x + outside.width / 2 > box.x + box.width / 2 ? "EAST" : "WEST";
          const fallback = expected === "NORTH" && tab.x + tab.width + 16 > box.x + box.width - 8 && ["WEST", "EAST"].includes(port.side);
          const toward = port.side === "NORTH" ? box.y + box.height / 2 - outside.y - outside.height / 2
            : port.side === "SOUTH" ? outside.y + outside.height / 2 - box.y - box.height / 2
            : port.side === "WEST" ? box.x + box.width / 2 - outside.x - outside.width / 2
            : outside.x + outside.width / 2 - box.x - box.width / 2;
          if (port.incoming !== to || port.side !== expected && !fallback && toward <= 0) portViolations.push(`${port.edge} / ${id}: wrong port direction ${port.side}`);
          if (port.side === "NORTH" && port.x < tab.x + tab.width + 16 - 0.03 ||
            ["WEST", "EAST"].includes(port.side) && port.y < tab.y + tab.height + 16 - 0.03) portViolations.push(`${port.edge} / ${id}: port enters tab span`);
          const onSide = port.side === "NORTH" ? near(port.y, box.y) : port.side === "SOUTH" ? near(port.y, box.y + box.height)
            : port.side === "WEST" ? near(port.x, box.x) : near(port.x, box.x + box.width);
          if (!onSide || !between(port.x, box.x, box.x + box.width) || !between(port.y, box.y, box.y + box.height)) portViolations.push(`${port.edge} / ${id}: port misses border`);
        }
      }
    }
  }
  return { borderViolations, portViolations, ports: ports.length };
}
