import { fontSize } from "./text.ts";

// Shared tokens keep tiles, panels and labels consistent in both themes.
export const style = `
svg {
  --font-family: "Arial", "BIZ UDPGothic", "Noto Sans JP", "Hiragino Sans", "Yu Gothic UI", "Meiryo", sans-serif;
  --font-mono: "BIZ UDGothic", "MS Gothic", monospace;
  --canvas: #ffffff; --text: #232830; --edge-text: #556171; --line: #596370; --accent: #2563eb;
  --node-fill: #ffffff; --node-stroke: #c7cdd5;
  --tile-shadow: #0f172a0f;
  --teal-fill: #b9f5ee; --teal-stroke: #008674;
  --blue-fill: #d0e5ff; --blue-stroke: #0772e6;
  --orange-fill: #ffdea7; --orange-stroke: #ec5a00;
  --green-fill: #c4f7c9; --green-stroke: #008b06;
  --purple-fill: #e6dcff; --purple-stroke: #6b3fd4;
  --tan-fill: #ece6dd; --tan-stroke: #7a6a55;
  --pink-fill: #ffd9ec; --pink-stroke: #c4247a;
  --yellow-fill: #fff1b8; --yellow-stroke: #b38600;
  --zone-fill: #f6f7f9; --zone-header: #e8ebef; --zone-stroke: #9aa1ab;
  --break-fill: #ffe3e5; --break-stroke: #d6141f; --break-text: #b0101a;
  --note-fill: #fff4c2; --note-stroke: #c9a400;
  font-family: var(--font-family);
  font-size: ${fontSize.node}px; line-height: 1.4; color: var(--text);
}
@media (prefers-color-scheme: dark) {
  svg {
    --canvas: #1f1f1f; --text: #f5f5f5; --edge-text: #bbc5d2; --line: #a0a6b0; --accent: #7eb0ff;
    --node-fill: #292c31; --node-stroke: #667485;
    --tile-shadow: #00000026;
    --teal-fill: #174b45; --teal-stroke: #58d8c7;
    --blue-fill: #183e66; --blue-stroke: #6bb1ff;
    --orange-fill: #633b1a; --orange-stroke: #ffa451;
    --green-fill: #214e27; --green-stroke: #62d86a;
    --purple-fill: #3c295f; --purple-stroke: #b69aff;
    --tan-fill: #494034; --tan-stroke: #c3af94;
    --pink-fill: #60213f; --pink-stroke: #f783bc;
    --yellow-fill: #594b1a; --yellow-stroke: #e2c65c;
    --zone-fill: #272a30; --zone-header: #343840; --zone-stroke: #8d95a1;
    --break-fill: #5c2028; --break-stroke: #ff7180; --break-text: #ffb0b8;
    --note-fill: #544819; --note-stroke: #ddc257;
  }
}
.canvas, .pill, .legend-body { fill: var(--canvas); }
text { fill: var(--text); stroke: none; }
.center { text-anchor: middle; }
.title { font-size: ${fontSize.title}px; font-weight: 700; }
.header { font-size: ${fontSize.header}px; font-weight: 700; }
.edge-label, .branch-label { font-family: var(--font-mono); font-size: ${fontSize.label}px; fill: var(--edge-text); }
.mono { font-family: var(--font-mono); }
.node .mono { fill: var(--edge-text); }
.legend-label { font-size: ${fontSize.legend}px; }
.legend-heading { font-weight: 700; }
.blue { --fill: var(--blue-fill); --stroke: var(--blue-stroke); }
.orange { --fill: var(--orange-fill); --stroke: var(--orange-stroke); }
.green { --fill: var(--green-fill); --stroke: var(--green-stroke); }
.purple { --fill: var(--purple-fill); --stroke: var(--purple-stroke); }
.yellow { --fill: var(--yellow-fill); --stroke: var(--yellow-stroke); }
.teal { --fill: var(--teal-fill); --stroke: var(--teal-stroke); }
.tan { --fill: var(--tan-fill); --stroke: var(--tan-stroke); }
.pink { --fill: var(--pink-fill); --stroke: var(--pink-stroke); }
.shape { fill: var(--node-fill); stroke: var(--stroke, var(--node-stroke)); stroke-width: 1px; filter: drop-shadow(0px 1px 1px var(--tile-shadow)); }
.swatch { fill: var(--fill, var(--node-fill)); stroke: var(--stroke, var(--node-stroke)); stroke-width: 1px; }
.external .shape { stroke-dasharray: 6 4; }
.bugPath { --stroke: var(--blue-stroke); }
.bugPath .shape, .bugPath.swatch { stroke-width: 1.5px; }
.breaks { --fill: var(--break-fill); --stroke: var(--break-stroke); }
.breaks .shape, .breaks.swatch { fill: var(--break-fill); stroke-width: 1.5px; }
.breaks text, .breaks .mono, .break-note text { fill: var(--break-text); }
.edge { fill: none; stroke: var(--connector, var(--line)); stroke-width: 1.5px; stroke-linejoin: round; }
.dashed .edge { stroke-dasharray: 4 5; }
.arrow-filled { fill: var(--connector, var(--line)); stroke: none; }
.arrow-open, .lost { fill: none; stroke: var(--connector, var(--line)); stroke-width: 1.5px; }
.primary { --connector: var(--accent); }
.trust-break { --connector: var(--break-stroke); }
.trust-break .edge { stroke-width: 1.5px; }
.container-body { fill: var(--zone-fill); stroke: var(--zone-stroke); stroke-width: 1.5px; }
.container-header { fill: none; stroke: none; }
.untrusted .container-body, .untrusted.swatch { fill: var(--zone-fill); stroke: var(--line); stroke-width: 1.5px; stroke-dasharray: 4 5; }
.container.breaks .container-body { fill: var(--break-fill); stroke: var(--break-stroke); stroke-width: 1.5px; }
.group .container-body { fill: var(--fill); fill-opacity: 0.12; stroke: var(--stroke); stroke-opacity: 0.6; stroke-width: 1.5px; }
.lock { fill: none; stroke: var(--text); stroke-width: 1.5px; }
.lock-body { fill: var(--text); stroke: none; }
.lifeline { stroke: var(--zone-stroke); stroke-width: 1.5px; stroke-dasharray: 6 4; }
.frame { fill: none; stroke: var(--zone-stroke); stroke-width: 1.5px; }
.frame-tab { fill: var(--zone-header); stroke: var(--zone-stroke); stroke-width: 1.5px; }
.branch-divider { stroke: var(--zone-stroke); stroke-width: 1.5px; stroke-dasharray: 6 4; }
.note-shape { fill: var(--note-fill); stroke: var(--note-stroke); stroke-width: 1.5px; }
.break-note .note-shape { fill: var(--break-fill); stroke: var(--break-stroke); }
.break-band { fill: var(--break-fill); }
.legend-body { stroke: var(--zone-stroke); stroke-width: 1px; }
`;
