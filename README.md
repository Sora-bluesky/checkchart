[English](README.md) | [日本語](README.ja.md)

# checkchart

checkchart is a Claude Code skill for flowcharts, sequence diagrams and architecture diagrams. It checks the facts behind a diagram before it draws anything, then writes Mermaid and, if you ask, its own SVG.

![An architecture diagram drawn by checkchart](examples/architecture/chart.svg)

A diagram should answer one question for one reader, so the skill starts there. You state who reads the chart and what it answers, then give only the facts that question needs. An existing diagram counts as a source of facts, not a layout to copy.

## What it checks

Rules decide the exit code. When one breaks, the report gives the shortest path to the problem and the chart marks it in red.

- In a flowchart, every node can be reached from a start and can still reach an end, and each decision has two or more ways out with different conditions.
- In a sequence diagram, every call gets a reply or declares a timeout, every reply answers an earlier call and goes back to the caller, and every lost message names what recovers from it.
- In an architecture diagram, both ends of every connection exist, and data that leaves an untrusted zone (agent output, a user's repository, a network peer) names the trusted component that checks it.
- In every chart, the view states a title, a reader and a question, and the product name is spelled the same way everywhere. Architecture arrows all need a label, and a zone may not wrap a single child zone and nothing else.

Warnings point at things that make a chart hard to read: deep nesting, two-way arrows, generic labels such as "uses", crossing lines, too many elements, mixed levels of detail, flows that loop back, and charts wider than 1100px. They do not change the exit code. Their thresholds are judgment calls, and [references/principles.md](skills/checkchart/references/principles.md) lists the sources behind them.

## How it works

You write two files:

- `model.json` holds the facts: nodes and edges, participants and messages, or zones, components and connections. It uses ids only.
- `view.mjs` holds the reader's words: title, reader, question, a label for each id, the text on each arrow, groups and their colors, and the product name.

Then run:

```sh
skills/checkchart/scripts/checkchart model.json --view view.mjs --out chart --svg
```

The command writes `chart.mmd`, `report.md` and, with `--svg`, `chart.svg`. It exits with 0 when every rule holds, 1 when a rule breaks, and 2 when the input is wrong.

The SVG is laid out with [ELK](https://eclipse.dev/elk/) and drawn by checkchart itself: square shapes of one size, right-angle lines that leave the face toward their target, labels next to their own line, zone names on tabs that lines do not cross, and a padlock with a dashed border on untrusted zones. It follows light and dark mode. Drawing needs no browser or network.

The Mermaid file uses the same title, Legend and seven group colors as the `statechart` skill in [pstack](https://github.com/cursor/plugins/tree/main/pstack), so charts from both skills sit together in one document. Render it with [Pele](https://pele.run), or add `--fill` to write the colors into the Mermaid text for GitHub, Obsidian and VS Code. checkchart does not draw state diagrams. Use statechart for those.

See [examples/](examples/) for one chart of each kind and a failing example for every rule, and [SKILL.md](skills/checkchart/SKILL.md) for the full rules.

## Install

checkchart runs on Node 22.18 or later, Bun 1.1.5 or later, or Deno 2 or later. Mermaid output needs no packages. SVG output needs [elkjs](https://github.com/kieler/elkjs), which only `--svg` loads:

```sh
cd skills/checkchart/scripts && npm ci
```

As a Claude Code plugin:

```sh
claude plugin marketplace add Sora-bluesky/checkchart
claude plugin install checkchart@checkchart
```

Or copy (or link) `skills/checkchart` into `~/.claude/skills/`.

## What it does not check

checkchart checks the shape of the facts you give it, not whether they are true. It cannot tell whether a condition can really happen, whether the order of messages is right for your protocol, or whether the component named in `checkedBy` really validates its input. It also cannot tell whether a reader understands the chart, so the skill asks you to hand the SVG to someone else with a short list of questions. The report lists what it did not check under "Checks not made".

## License

MIT. checkchart adapts code and colors from pstack's statechart skill (MIT, Lauren Tan). elkjs is an optional dependency under EPL-2.0 or GPL-3.0-or-later and is not included here. See [NOTICE](NOTICE).
