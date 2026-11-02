# acme request processing

Reader: A maintainer
Question: How does a request reach stored data?

The model has 4 components and 3 connections. The chart draws 4 components and 3 arrows.

## Warnings
- DeepNesting: Service boundary > Application process > Worker group has 3 zone levels. Flatten the nesting or split the chart to keep at most 2 levels of context.
- TwoWayArrow: Client to Request router: Split it into two one-way arrows, or say what goes each way in the label.
- MixedLevels: Client (context), Request router (component), Worker (component), Stored data (component) mix abstraction levels. Put each level in separate charts with its own question.
- GenericLabel: Client to Request router has the generic label "Uses.". Describe the action and the data or result, using a verb and a noun.

## Rules that hold
EndsDeclared, TrustChecked, Connected, PurposeStated, NoRedundantContainer, ArrowsLabeled

## Checks not made
- Crossings between arrows in the final layout (requires --svg)
- whether checkedBy really validates its input
- data flow inside a component
