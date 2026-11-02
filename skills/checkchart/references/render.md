# Render a chart

Use `--svg` to write a standalone `chart.svg` beside `chart.mmd` and `report.md`. Install the dependency once from `<skill dir>/scripts`:

```sh
npm install
```

Then run from the scratch folder containing the model and view:

```sh
<skill dir>/scripts/checkchart model.json --view view.mjs --out chart --svg
```

Install once. Only `--svg` loads elkjs; Mermaid and reports need no packages. Generation uses no browser, image service or network. An unavailable elkjs exits 2 before any files are published. The SVG has a title, an accessible image role, fixed dimensions and a viewBox. Give the SVG to the reader for documents; use Mermaid text wherever that is the supported format.

## Native SVG look

The native renderer follows the Lucidchart examples and connector conventions: a white canvas, square process boxes with a light fill and a saturated 2.5px border, orthogonal elbow connectors, and solid filled arrowheads. Connectors are 2px `#4b525d`; dashed connectors use `6 4`. Bends have a 4px radius. Two-way connections have an arrowhead at each end. Edge labels have a white pill with 4px corners and 4px vertical / 6px horizontal padding.

Text is `#232830`, using "BIZ UDPGothic", "Noto Sans JP", "Hiragino Sans", "Yu Gothic UI", "Meiryo", "Segoe UI", sans-serif. Body text is 15px, edge labels 13.5px, titles 20px bold, and container tabs 14px semibold. Titles sit above the drawing with 24px canvas margins. A Legend, when Mermaid has one, sits at the top-right above the diagram. It shares the Mermaid group names and rule/path wording, but never becomes a layout node or pushes the diagram sideways. Sequence group bands carry their own names and need no separate Legend.

Keep the flow in one direction. Prefer about three colors; give a key when colors carry meaning. The renderer preserves every group the view requests, even when there are more than three. Shapes of the same kind share the chart's maximum measured width and height: at least 140x52, decisions at least 160x90, and no wider than 260. Start/end and person shapes are stadiums, decisions diamonds, stores cylinders, and external components square boxes with dashed borders.

Text is measured without a browser: wide/fullwidth characters use 1em, uppercase ASCII and digits 0.62em, lowercase 0.55em, narrow characters and spaces 0.3em, and other characters 0.6em. Combining marks add no width. Labels use the available width before wrapping. Breaks are allowed at spaces, after ：・、。）」, and between two CJK characters; explicit line breaks remain hard breaks. ASCII words and numbers stay intact. An indivisible token wider than its text budget keeps its natural width; its box and canvas grow without shrinking the text. Node padding is 16px horizontally and 12px vertically, with extra space for diamond slopes and cylinder caps. These are estimates; installed fonts can change the precise text appearance.

## Colors and marks

| Class | Light fill | Border |
| --- | --- | --- |
| teal | #b9f5ee | #008674 |
| blue | #d0e5ff | #0772e6 |
| orange | #ffdea7 | #ec5a00 |
| green | #c4f7c9 | #008b06 |
| purple | #e6dcff | #6b3fd4 |
| tan | #ece6dd | #7a6a55 |
| pink | #ffd9ec | #c4247a |
| yellow | #fff1b8 | #b38600 |
| no group | #ffffff | #4b525d |

Teal, blue, orange and green are the measured Lucidchart pairs. Purple, tan, pink and yellow follow the same light-fill / saturated-border approach. Green is a palette reference; the view's existing seven color names stay the same. Yellow uses its own yellow pair.

`breaks` uses fill #ffe3e5, a 3.5px #d6141f border and semibold #b0101a text. `bugPath` uses a 3.5px blue border and keeps the group fill. A broken node keeps its red border even when also on the blue path. A connection that breaks `TrustChecked` is red at 2.5px. Sequence failures get a pale red row band and a red note naming the rule, including failures on undeclared messages and unused participants.

Architecture containers have square corners, fill #f6f7f9, a 1.5px #9aa1ab border and a #e8ebef tab. Tab text uses its own 320px width budget, with 12px horizontal padding on each side and 18px more for a padlock. The zone grows to at least the tab width plus 48px. Text that fits in 320px stays on one line unless the author included a hard break; longer text uses the text module's break rules. No percentage cap shrinks or rewraps a tab. Keep captions to at most two lines by shortening them when necessary. Zones with `untrusted: true` use a 2px dashed #4b525d border and a padlock drawn from SVG paths and rectangles. No font icon or emoji is needed. Mermaid also uses dashed borders for these zones. Both renderers label the notation "Untrusted content" in the legend. Only data flowing from an untrusted component into a trusted component needs `checkedBy` naming the trusted receiver; a bidirectional connection includes that incoming direction.

All colors live in CSS custom properties. SVG elements use classes, so `@media (prefers-color-scheme: dark)` changes the canvas to #1f1f1f, text to #f5f5f5, connectors to #a0a6b0, group fills to dark tones of the same hues and borders to lighter tones. Labels use the canvas color. A viewer must support SVG CSS media queries to switch automatically; viewers that do not support them retain the light palette.

## Layout choices

Flow and architecture use ELK's layered layout with compound content measured recursively (`SEPARATE_CHILDREN`). Directions map TB/TD to DOWN, BT to UP, LR to RIGHT and RL to LEFT. Model-order consideration is NODES_AND_EDGES, with random seed 1. ELK reserves measured labels and 40px between nodes, 60px between layers, and 40px around zone contents below the tab. Its natural reading direction is retained. Charts wider than 1100px receive `WideChart`, asking the author to shorten labels, split the chart or change direction; no fallback stacks zone children or scales the text down.

The router reserves straight edges before spreading ports. When boxes overlap across the flow by at least 16px and the lane is clear, their edge uses the center of that overlap. Other ports follow the opposite endpoints in 32px steps toward their peers, with a 24px normal lead. Parallel pairs reserve their complete lane envelope past zone tabs before boundary ports are chosen, including BT and RL directions. A decision prefers one edge per vertex across incoming and outgoing edges together; straight edges and the first outgoing edge in model order take their facing vertices first. Side branches use the remaining side vertices. More than four incident ends share a vertex with a `LayoutCompromise` warning. Distinct vertices take precedence over parallel lanes at a decision.

A decision self-loop, such as `check -> check` when `retry`, is legal. It leaves and returns to a free side vertex, with a visible loop and its label beside the loop. The loop prefers a side and orientation clear of other nodes and tabs. Its endpoints coincide, so its Manhattan distance is zero: decision self-loops are exempt from the 1.8 detour-ratio goal. Ordinary graph routes and sequence self messages retain that goal.

Faces point toward the other endpoint. A free L uses one bend; opposing faces otherwise use two when clear. A blocked preferred face can use another target-facing side. Obstacle detours minimize bends before distance. Straight lines and Ls are chosen as complete paths before being split at zone borders, so borders cannot introduce extra turns. Free rectangular siblings align by node centers while preserving containment and paired corridors. Reciprocal box-face lanes retain a straight corridor, with unrelated content moved out of that corridor. Two-lane exchanges put labels outside the pair. With three or more parallel arrows, lanes and node bodies grow enough to fit central labels between lanes, keeping 4px to each line; text sizes and text width caps stay unchanged. Invalid ancestry is drawn flat; connections to undeclared components are omitted, matching Mermaid and the report.

Labels first choose a part of their own route outside every zone that does not contain both ends, such as the gap between endpoint zones. Next they use a zone containing both ends, or otherwise the segment nearest the route midpoint. Within a zone choice, positions inside the existing canvas are preferred, then longer segments in the reading axis. A gap too small for its label grows, moving following subtrees and preserving shared ancestor space. Labels stay 4px beside their segment on the outer side, at least 16px from unrelated nodes, and clear of tabs, other labels and other edges. Only placed labels reserve space; later routes avoid those fixed labels. The final label box must be within 8px of its own edge and may not be closer to another edge.

Placement and routing goals never reject a valid model. If the preferred zone segment has no label position, the renderer searches every segment of that edge, then places the whole label beside its route midpoint on the side with the largest clearance. Routes first relax minimum jog length and normal leads, then border clearance, then the 1.8 detour limit. If no collision-free route exists, the edge is still drawn. `report.md` names the edge and each unmet goal with `LayoutCompromise`, including compromises introduced by final routing around text. Only the model's checks decide exit 0 or 1; a placement search returning no candidate does not produce exit 2. Malformed input, output errors, unavailable dependencies and internal invariant failures can still produce exit 2.

Sequences use their own layout. Participant boxes have dashed lifelines and repeated footer boxes. Rows have a minimum 40px pitch, growing for wrapped labels, self loops and notes. Self-message loops are 24px wide and 60px high, so their length divided by the Manhattan distance between endpoints is 1.8. Message and self-message labels keep unbreakable words whole. Calls have filled heads; replies have dashed lines and open heads; signals have solid lines and open heads; lost messages stop at an X before the target. Notes have folded corners. Parallel frames have a par tab, bracketed branch names and dashed branch dividers, including nested frames. Frames start with the involved lifelines plus 24px on each side, then grow to contain every branch caption, message label, note and nested frame. The complete scene translates right if any label or frame would start at a negative x, and the canvas grows on both sides to contain the measured content. Failure bands span their involved lifelines plus 24px on each side. Contiguous participant groups use their light color at 12% opacity behind the lifelines, a full-tone light tab fitted to its text with the same 320px budget and 48px reserve, and a 1.5px group-colored border at 60% opacity.

## Visual quality baseline

From `skills/checkchart/scripts`, run:

```sh
node --disable-warning=ExperimentalWarning --test test/*.test.ts
```

`test/visual-quality-baseline.json` records the four main examples and every `model.json` fixture in `test/fixtures/`. The audit reads the final emitted SVG, including any final text routing. It measures total bends (merging collinear section joins), total edge length, transverse crossings, maximum and mean label-box distance to their own edge, maximum edge detour ratio, maximum and total tab lines, same-face crossings, misleading label ownership, and canvas width and height. Counts may never increase; other measurements may grow by at most 5%. Hard limits additionally require nonexempt edge detour ratios to be at most 1.8, labels within 8px and never closer to another edge, at least 16px between every label and unrelated node, tabs at most two lines, and zero crossings between routes attached to the same node face. Sequence self messages are included in the detour calculation; closed decision self-loops are explicitly exempt.

`test/fixtures/rendering/` holds eight separate regression model/view pairs, including valid inputs that need layout compromises. `rendering-resilience.test.ts` checks their CLI exit codes, published files, warnings and geometry, along with nested frame containment, all-direction parallel lanes and a deterministic generated corpus of small valid models. These regressions do not replace or raise the strict corpus baseline.

Each audited graph edge must also use the minimum bends for its endpoints and faces: a clear shared lane has zero, a free L has one, and a clear opposing-face route has two. An independent visibility search checks obstacle exceptions and records their reasons in `bendExceptions`; unnecessary bends fail. Sequence arrows use message-row lifelines rather than participant-box ports, with two bends for a self message.

To update deliberately, first inspect the generated SVGs and compare measurements:

```sh
node --disable-warning=ExperimentalWarning test/update-visual-quality.ts --snapshot=.tmp/quality-candidate.json
node --disable-warning=ExperimentalWarning test/update-visual-quality.ts --update
node --disable-warning=ExperimentalWarning --test test/*.test.ts
```

Snapshots and regenerated charts stay under the worktree's `.tmp/`. The updater checks hard limits before replacing the baseline, and writes only the explicit public corpus into the JSON. Review the baseline diff together with the SVG changes; do not raise values simply to clear a failing test. Deliberate caption changes in fixtures must retain the relevant wrapping and containment boundaries.

Set `CHECKCHART_PARENT_CHARTS` to a local read-only folder containing `archA`, `archB`, `flow` and `seq`, each with `model.json` and `view.mjs`, to run the same hard limits on those charts. Their SVGs and detailed measurements go under `.tmp/`; their names, labels and paths never enter the public baseline. The snapshot command includes these local measurements when the variable is set; `--update` always excludes them.

## Mermaid-only places

Show `chart.mmd` as a mermaid code block, or render it with Pele where a Mermaid renderer is required. Mermaid entity codes keep label text literal, including icon-like tokens, markdown and visible Unicode spaces. Install Pele separately, outside the repo. With `pele@1.9.0`, call `render` with `{ limit: 1_000_000, outputLimit: 8_000_000, maxEdges: 10_000 }`. Its API is at https://pele.run/api. If it throws a `PeleError`, show the Mermaid text and the error.

Use `--fill` for Mermaid viewers without Pele. It adds light group colors and bug-path styling; sequence groups receive their colors directly on Mermaid boxes. Pele's layout and theme behavior differ from the native SVG. Its CSS variables are documented at https://pele.run/theming. Do not overwrite the native `chart.svg` with a Pele rendering; use a separate filename.
