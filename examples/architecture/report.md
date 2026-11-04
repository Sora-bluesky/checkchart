# acme connections

Reader: A maintainer
Question: Where does data enter acme, and where does it end up?

The model has 4 components and 3 connections. The chart draws 4 components and 3 arrows.

## Warnings
None.

## Rules that hold
EndsDeclared, TrustChecked, Connected, PurposeStated, NoRedundantContainer, ArrowsLabeled, ProductName

## Checks not made
- Crossings between arrows in the final layout (requires --svg)
- whether checkedBy really validates its input
- data flow inside a component
