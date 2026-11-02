---
name: checkchart
description: "Decide the reader and the one question a diagram answers, check its facts and readability, then draw a flowchart, sequence diagram or architecture diagram as Mermaid or native SVG. Reports distinguish broken structural rules from advisory warnings. Use for /checkchart or diagrams for a design document."
---

# Checkchart

A diagram answers one question for one reader. Read the source for facts; decide the diagram's scope and shape from that question. The evidence and limits behind this workflow are in [references/principles.md](references/principles.md).

## Purpose first

1. Read the source only for facts: participants, components, containment, actions, conditions and exchanges. An existing diagram is a source of facts, not a layout to copy.
2. Decide who reads the chart and the one question it answers. Write `title`, `reader` and `question` in the view before drawing. Include the diagram kind and scope in the title.
3. Keep only facts the question needs. Preserve the facts that determine correctness, including failing paths; do not weaken facts to make a rule hold.
4. Split into several charts when the question set has more than one or two concerns, or a warning suggests a split. Give each chart its own reader and question.
5. Draw, read the report and fix structural failures. Consider each warning in the context of the reader's task.
6. Hand the SVG to a separate reader: a fresh session or a person. Use the C4 model checklist questions under Hand off; the tool cannot answer them.

## Run

Work in a scratch folder outside the repo. Write `model.json` and `view.mjs`, then run:

```sh
<skill dir>/scripts/checkchart model.json --view view.mjs --out chart --svg
```

The launcher needs Node 22.18 to 22.x, Node 23.6 or later, Bun 1.1.5 or later, or Deno 2 or later. You can also run `node --disable-warning=ExperimentalWarning <skill dir>/scripts/checkchart.ts model.json`.

Native SVG needs elkjs installed in `<skill dir>/scripts`. Only `--svg` loads it. Drawing needs no network or browser. Without `--svg`, the command writes Mermaid and a report without loading packages. See [references/render.md](references/render.md) for SVG appearance and Mermaid rendering with Pele.

The output folder must be new or empty. Without `--out`, it is `model-chart` beside `model.json`. The command writes `chart.mmd` and `report.md`, prints the report, and adds `chart.svg` with `--svg`. Exit 0 means every rule holds, even if warnings remain. Exit 1 means a rule breaks. Exit 2 means an input error; no files are published.

## State the purpose and labels

Put the view in a trusted local module: loading it executes code. Unknown exports are errors.

```js
export const title = "acme flow: save a request";
export const reader = "A maintainer checking request handling";
export const question = "How does a valid request reach stored data?";
export const label = { start: "Receive a request", done: "Return the result" };
export const step = () => "Sends the request data";
```

- `title`, `reader`, `question`: strings, each non-empty for `PurposeStated`. Missing the view breaks this rule. Reader and question appear only at the top of the report, never in the drawing.
- `product`: optional exact product spelling, such as `acme`. `ProductName` checks its case in drawn titles, labels, arrow labels and used group names. The name must appear in the title or an element label. It matches without adjacent ASCII letters or digits; CJK neighbors are allowed.
- `label(id, kind, fact)`: a string, or use an object from id to string. Missing map entries use the id. Kinds are `node`, `participant`, `component`, `zone`, `branch`. Use `\n` for a hard line break. Prefer verb plus noun for flow steps and name plus role for components.
- `group(id, kind, fact)`: a group name or `undefined`, or use an object from id to group. It colors nodes, components and participants, and requires `colors`.
- `colors`: group names mapped to `blue`, `orange`, `purple`, `yellow`, `teal`, `tan` or `pink`. Give color one consistent meaning; group names also appear as text.
- `step(arrow)`: the action or data exchanged, expressed in the reader's words. It receives the edge, connection or message, including its optional `id`. For sequences, notes also pass through it. It runs once per item; the report and both drawings reuse the answer.

Without `step`, flow labels use `when`, architecture connections have no label, and sequence messages use their id or type. Return `null` to hide a flow label. A null, empty or whitespace-only architecture label breaks `ArrowsLabeled`; a sequence label must be a string. Label and group callbacks also run once per element, with immutable facts. Participant facts are ids; branch facts are message lists.

## Write the facts

Use ids matching `^[A-Za-z][A-Za-z0-9_]*$`. Unknown keys are errors. Facts belong in the model; reader-facing words belong in the view. State diagrams belong to pstack's statechart skill.

### Flow

```json
{"kind":"flow","direction":"TB","nodes":{"start":{"type":"start"},"check":{"type":"decision"},"save":{},"db":{"type":"store"},"done":{"type":"end"}},"edges":[{"from":"start","to":"check"},{"from":"check","to":"save","when":"valid"},{"from":"check","to":"done","when":"invalid"},{"from":"save","to":"db","style":"dashed"},{"from":"save","to":"done"}]}
```

Direction defaults to `TB`, or use `TD`, `LR`, `RL`, `BT`. Node type defaults to `step`, or use `start`, `decision`, `store`, `end`. Edge style defaults to `solid`, or use `dashed`. `when` is a condition id. Optional edge ids must be unique among edges.

- `HasStartAndEnd`: at least one start and one end.
- `Reachable`: a start can reach every node.
- `HasExit`: every non-end, non-store node has a way forward to a non-store node.
- `ReachesEnd`: every non-store node can reach an end without passing through a store.
- `DecisionBranches`: at least two outgoing edges per decision, each with a different `when`.
- `EndIsFinal`: ends lead only to stores.

A store is a side target, not a way forward. The SVG main path is the longest simple start-to-end path restricted to the first outgoing edge of each decision in model order. Condition ids do not imply success or failure. Main edges get high ELK straightness and direction priorities and centered ports. Declared node order is the main reading order used to count backward edges.

### Sequence

```json
{"kind":"sequence","participants":["ui","core"],"messages":[{"id":"request","from":"ui","to":"core","type":"call"},{"from":"core","to":"ui","type":"reply","answers":"request"},{"from":"core","to":"core","type":"self"},{"type":"note","over":["core"]},{"par":[[{"from":"core","to":"ui","type":"signal"}],[{"id":"retry","from":"ui","to":"core","type":"call","timeout":true}]]}]}
```

Message types are `call`, `reply`, `signal`, `lost`, `self`, `note`. Give a message an id when another names it. A note's `over` names one or two participants. `par` has at least two message lists and may nest. Its optional `branches` gives one id per branch; the view labels them. Unnamed branches use "Branch 1", "Branch 2", and so on.

- `Declared`: all named participants exist; every declared participant appears in a message.
- `Answered`: every call has a later reply naming its id in `answers`, or declares `timeout: true`.
- `ReplyMatches`: replies name an earlier call, go back to its caller and answer it only once.
- `Recovered`: a lost message names a later message in `recovery`.
- `SelfIsSelf`: a self message goes to itself; other arrows go to someone else.

Later means document order: parallel branches in order, nested lists depth first. This does not prove a concurrent schedule. Participants in a group are made contiguous in stable order; the report states when they move. A single-participant group is allowed.

### Architecture

```json
{"kind":"architecture","direction":"LR","zones":{"process":{},"storage":{}},"components":{"app":{"zone":"process","level":"component"},"db":{"zone":"storage","shape":"store","level":"component"}},"connections":[{"id":"save","from":"app","to":"db"}]}
```

Zones and components have separate id namespaces. Zones may have `parent` and `untrusted: true`, meaning their content must not be trusted (for example, agent output, user repositories or network peers). Other zones are plain groups. The old `trust` key is an unknown-key error. Components may have `zone`, `shape` (`box`, `store`, `person`, `external`) and optional `level` (`context`, `container`, `component`, `code`, `deployment`). Connections have optional unique `id`, `dir` (`one` or `both`), `style` (`solid` or `dashed`) and `checkedBy`.

- `EndsDeclared`: ends, component zones and zone parents exist; parents have no cycles.
- `TrustChecked`: a one-way connection from untrusted content to a trusted component requires `checkedBy` equal to `to`. A `both` connection between untrusted and trusted components requires the trusted endpoint, regardless of which end is `from`. One-way input into untrusted content, or connections between two trusted or two untrusted components, need no checker.
- `Connected`: every component takes part in a connection.
- `NoRedundantContainer`: a zone cannot contain only one child zone and no direct component. Put the outer meaning into the child's label, or draw the sibling it is meant to group.
- `ArrowsLabeled`: every drawn connection has a non-empty `step` label.

A component is untrusted if its zone or any ancestor zone is `untrusted: true`; `untrusted: false` on a child does not override an untrusted ancestor. Components outside those zones are trusted. `checkedBy` remains allowed when no check is required. Untrusted zones have dashed borders in Mermaid and SVG, a padlock in the SVG header, and an "Untrusted content" legend entry. Reports trace unchecked input from its untrusted source to the trusted receiver. Invalid ancestry is drawn flat and reported; undeclared connections are omitted. Redundant outer zones have `breaks` on the Mermaid subgraph and a red SVG border and header.

## Read warnings and evidence

Warnings do not change the exit code. Thresholds are advisory choices, not measured universal limits:

- `DeepNesting`: more than two zone levels; flatten or split.
- `TwoWayArrow`: `dir: both`; split into two one-way arrows or say what goes each way.
- `GenericLabel`: only a generic verb such as "uses", "calls", "connects", "talks to", "使う", "呼ぶ", "接続", "連携", "通信", ignoring case and trailing punctuation; state the action and data.
- `Crossings`: any crossings between distinct arrows in the final flow/architecture SVG layout; reroute or split. Shared endpoints and touching or overlapping routes are not crossings. Without `--svg`, this is under "Checks not made".
- `TooManyElements`: over 12 flow nodes or architecture components, 6 sequence participants, 5 direct children in a zone, 5 branches in any `par`, or 6 used color groups; reduce scope or split.
- `MixedLevels`: more than one specified architecture `level`; use separate charts.
- `FlowLoopsBack`: more than two edges to earlier nodes in the declared order; consider a sequence diagram.

Aim for about 20 drawn arrows or fewer. Notes and legend entries are not arrows. A report lists warnings before "Rules that hold". Rules show at most five offenders, shortest path first, then count the rest; charts mark all offenders. Flow failures show shortest paths from any start, or explain unreachability and loops. Sequence paths show involved messages in document order. Architecture paths name both ends.

Flow and architecture use `breaks` for failures and `bugPath` for flow evidence paths, with a Legend. Sequence failures use pale red bands and notes naming the rule. Use `--fill` for Mermaid viewers without Pele to add group fills and path styling. Read "Checks not made": declared facts cannot prove real conditions, protocol schedules, input validation or component internals.

## Hand off

Give the SVG to a separate reader, with the stated reader and question. Ask these C4 model checklist questions and require an explanation for each "no":

- Do you understand what every element does?
- Do you understand what every arrow means and which way it goes?
- Do you understand what every color means?
- Does the title identify the diagram kind and scope? Are roles, abbreviations and boundaries clear without the source?
- Can you answer the stated question from this diagram?

Report each bug with its rule, the reader's sentence and its path; include warning decisions and omitted checks. Give the command to regenerate into a new output folder. When facts describe code, replay bug paths as tests or live reproductions. If a path cannot happen, check the model before changing the facts.
