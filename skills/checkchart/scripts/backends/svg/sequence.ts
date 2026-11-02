import {
  keyOf, labelOf, messagesOf, participantOrder, participantsOf, stepOf,
  type Answers, type Check, type Message, type Sequence, type SequenceItem,
} from "../../ir.ts";
import { ruleNames, sequenceMarks } from "../presentation.ts";
import { captions } from "../captions.ts";
import { emptyScene, type Note, type SvgNode } from "./scene.ts";
import { edgeLabelBlock, fontSize, headerHeight, textBlock, widthBudget } from "./text.ts";
import { routeTextObstacles } from "./obstacles.ts";

export function sequenceScene(model: Sequence, answers: Answers, check: Check) {
  const caption = captions[answers.locale ?? "en"];
  const scene = emptyScene();
  const order = participantOrder(model, answers);
  const labels = order.map((id) => textBlock(labelOf(answers, "participant", id), 228, fontSize.node, "first"));
  const width = Math.max(140, ...labels.map((text) => text.width + 32));
  const compact = order.length * (width + 32) + 64 > widthBudget;
  const gap = compact ? 8 : 32, margin = compact ? 16 : 24;
  const widths = new Map(order.map((id, index) => [id, compact ? Math.max(140, labels[index].width + 32) : width]));
  const height = Math.max(52, ...labels.map((text) => text.height + 24));
  const loopSpace = new Map(order.map((id) => [id, Math.max(0, ...messagesOf(model.messages)
    .filter((message) => message.type !== "note" && message.from === id && message.to === id)
    // Self arrows extend 24px; their centered pill needs only its right half,
    // rather than the old full-label reservation for a 136px loop.
    .map((message) => Math.max(24, (edgeLabelBlock(stepOf(answers, message) ?? "").width + 12) / 2 + 12) + 12 - widths.get(id)! / 2))]));
  const groupSpace = new Map<string, number>();
  for (const group of new Set(order.map((id) => answers.groups.get(keyOf({ kind: "participant", id }))))) {
    if (group === undefined) continue;
    const members = order.filter((id) => answers.groups.get(keyOf({ kind: "participant", id })) === group);
    const last = members.at(-1)!;
    groupSpace.set(last, Math.max(0, textBlock(group, 320, fontSize.header, 700).width + 24 + 48 -
      (members.reduce((sum, id) => sum + widths.get(id)!, 0) + (members.length - 1) * gap + loopSpace.get(last)! + 24)));
  }
  let column = margin;
  const columns = order.map((id, index) => {
    const x = column;
    const group = answers.groups.get(keyOf({ kind: "participant", id }));
    const next = order[index + 1];
    const nextGroup = next === undefined ? undefined : answers.groups.get(keyOf({ kind: "participant", id: next }));
    const spacing = group !== nextGroup ? Math.max(24, gap) : gap;
    column += widths.get(id)! + spacing + loopSpace.get(id)! + (groupSpace.get(id) ?? 0);
    return x;
  });
  const centers = new Map(order.map((id, index) => [id, columns[index] + widths.get(id)! / 2]));
  const drawnGroups = new Set<string>();
  for (const [index, id] of order.entries()) {
    const group = answers.groups.get(keyOf({ kind: "participant", id }));
    if (group === undefined || drawnGroups.has(group)) continue;
    drawnGroups.add(group);
    const members = order.filter((id) => answers.groups.get(keyOf({ kind: "participant", id })) === group);
    const last = members.at(-1)!;
    const groupWidth = centers.get(last)! + widths.get(last)! / 2 + loopSpace.get(last)! + (groupSpace.get(last) ?? 0) + 12 - (columns[index] - 12);
    const text = textBlock(group, 320, fontSize.header, 700);
    const color = answers.colors.get(group);
    scene.containers.push({ id: `group-${index}`, box: { x: columns[index] - 12, y: 0, width: groupWidth, height: 0 }, text, headerHeight: headerHeight(text), untrusted: false, classes: color ? [color] : [], sequence: true });
  }
  const grouped = scene.containers.length > 0;
  const headerY = grouped ? Math.max(...scene.containers.map((group) => group.headerHeight)) + 12 : 0;
  const span = (participants: string[]) => {
    const touched = participants.flatMap((id) => centers.has(id) ? [centers.get(id)!] : []);
    const left = touched.length ? Math.min(...touched) : centers.values().next().value ?? 140;
    const right = touched.length ? Math.max(...touched) : left;
    return { x: left - 24, width: right - left + 48 };
  };
  const headers: SvgNode[] = order.map((id, index) => {
    const group = answers.groups.get(keyOf({ kind: "participant", id }));
    const color = group === undefined ? undefined : answers.colors.get(group);
    return { id: `p${index}`, shape: "box", box: { x: columns[index], y: headerY, width: widths.get(id)!, height }, text: labels[index], classes: color ? [color] : [] };
  });
  scene.nodes.push(...headers);
  const last = order.at(-1);
  scene.width = Math.max(280, last === undefined ? margin * 2 : columns.at(-1)! + widths.get(last)! + loopSpace.get(last)! + (groupSpace.get(last) ?? 0) + margin);
  let cursor = headerY + height + 28;
  let messageIndex = 0;
  const { messageRules, standalone } = sequenceMarks(model, check);
  const sticky = (label: string, center: number, y: number, id: string, broken = false): Note => {
    const text = textBlock(label);
    const box = { x: Math.max(8, center - Math.max(140, text.width + 32) / 2), y, width: Math.max(140, text.width + 32), height: text.height + 24 };
    scene.width = Math.max(scene.width, box.x + box.width + 16);
    return { id, box, text, broken };
  };
  for (const [index, mark] of standalone.entries()) {
    const center = centers.get(mark.ref?.id ?? "") ?? centers.values().next().value ?? 140;
    const note = sticky(caption.breaks(mark.rule), center, cursor, `standalone-${index}`, true);
    scene.notes.push(note);
    scene.bands.push({ ...span(mark.ref ? [mark.ref.id] : order), y: cursor - 4, height: note.box.height + 8 });
    cursor += note.box.height + 20;
  }
  const messageRow = (message: Message) => {
    const index = messageIndex++;
    const top = cursor;
    const rules = messageRules.get(index) ?? [];
    const participants = participantsOf(message);
    const known = participants.every((id) => centers.has(id));
    const target = centers.get(participants.at(-1) ?? "") ?? centers.values().next().value ?? 140;
    if (!known || message.type === "note") {
      const from = centers.get(participants[0]) ?? target;
      const note = sticky((stepOf(answers, message) ?? "") + (known ? "" : ` (${caption.undeclared})`), (from + target) / 2, cursor, `note-${index}`);
      scene.notes.push(note);
      cursor += note.box.height + 16;
    } else {
      const from = centers.get(message.from) ?? target;
      // An invalid self message still shows its declared endpoints, like Mermaid.
      const loop = from === target;
      const text = edgeLabelBlock(stepOf(answers, message) ?? "");
      const loopWidth = 24, loopHeight = 60;
      const box = { x: (loop ? from + loopWidth / 2 : (from + target) / 2) - (text.width + 12) / 2, y: cursor, width: text.width + 12, height: text.height + 8 };
      const lineY = cursor + box.height + 6;
      const sign = target >= from ? 1 : -1;
      const end = message.type === "lost" ? target - sign * 14 : target;
      const points = loop
        ? [{ x: from, y: lineY }, { x: from + loopWidth, y: lineY }, { x: from + loopWidth, y: lineY + loopHeight }, { x: target, y: lineY + loopHeight }]
        : [{ x: from, y: lineY }, { x: end, y: lineY }];
      scene.edges.push({ id: `m${index}`, sections: [points], dashed: message.type === "reply", head: message.type === "lost" ? "lost" : ["reply", "signal"].includes(message.type) ? "open" : "filled", labels: [{ id: `m${index}-label`, text, box }] });
      scene.width = Math.max(scene.width, box.x + box.width + 24, loop ? from + loopWidth + 24 : 0);
      cursor += Math.max(40, box.height + 16) + (loop ? loopHeight : 0);
    }
    if (rules.length) {
      const note = sticky(caption.breaks(ruleNames(rules)), target, cursor + 2, `break-${index}`, true);
      scene.notes.push(note);
      cursor = note.box.y + note.box.height + 12;
      scene.bands.push({ ...span(participants), y: top - 4, height: cursor - top + 4 });
    }
  };
  const draw = (items: SequenceItem[]) => {
    for (const item of items) {
      if (item.kind === "message") { messageRow(item); continue; }
      const firstEdge = scene.edges.length, firstNote = scene.notes.length, firstFrame = scene.frames.length;
      const frame = { id: `par${scene.frames.length}`, box: { ...span(messagesOf(item.par.flat()).flatMap(participantsOf)), y: cursor, height: 0 }, branches: [] as { y: number; text: ReturnType<typeof textBlock> }[] };
      scene.frames.push(frame);
      cursor += 30;
      for (const [index, branch] of item.par.entries()) {
        const name = item.branches === undefined ? caption.branch(index + 1) : answers.branchLabels.get(branch) ?? item.branches[index];
        const text = edgeLabelBlock(`[${name}]`);
        frame.branches.push({ y: cursor, text });
        cursor += text.height + 14;
        draw(branch);
        cursor += 12;
      }
      frame.box.height = cursor - frame.box.y;
      const content = [...scene.edges.slice(firstEdge).flatMap((edge) => edge.labels), ...scene.notes.slice(firstNote),
        ...scene.frames.slice(firstFrame + 1)].map((item) => item.box);
      const right = Math.max(frame.box.x + frame.box.width, ...content.map((box) => box.x + box.width + 12));
      frame.box.x = Math.min(frame.box.x, ...content.map((box) => box.x - 12));
      frame.box.width = Math.max(right - frame.box.x, 46, textBlock(caption.parallel, 40, fontSize.header, 700).width + 16, ...frame.branches.map((branch) => branch.text.width + 24));
      cursor += 16;
    }
  };
  draw(model.messages);
  const footerY = cursor + 20;
  for (const node of headers) scene.nodes.push({ ...node, id: `${node.id}-footer`, box: { ...node.box, y: footerY } });
  scene.height = footerY + height + (grouped ? 12 : 0);
  for (const [id, center] of centers) {
    scene.lifelines.push({ x: center, top: headerY + height, bottom: footerY });
  }
  for (const group of scene.containers) group.box.height = scene.height;
  // Whole words can be wider than a message span. Translate the complete scene
  // once so labels, nested frames, headers and lifelines keep their alignment.
  const boxes = [...scene.nodes, ...scene.containers, ...scene.notes, ...scene.frames,
    ...scene.edges.flatMap((edge) => edge.labels)].map((item) => item.box);
  const points = new Set(scene.edges.flatMap((edge) => edge.sections.flat()));
  const dx = Math.max(0, -Math.min(0, ...boxes.map((box) => box.x), ...[...points].map((point) => point.x)));
  for (const box of [...boxes, ...scene.bands]) box.x += dx;
  for (const point of points) point.x += dx;
  for (const line of scene.lifelines) line.x += dx;
  scene.width = Math.max(scene.width + dx, ...boxes.map((box) => box.x + box.width));
  routeTextObstacles(scene);
  return scene;
}
