# acme connections

Reader: A maintainer
Question: Which components exchange a request and its data?

The model has 4 components and 4 connections. The chart draws 4 components and 4 arrows.

## Warnings
- TwoWayArrow: acme to Saved data: Split it into two one-way arrows, or say what goes each way in the label.

## Rules that hold
EndsDeclared, TrustChecked, Connected, PurposeStated, NoRedundantContainer, ArrowsLabeled, ProductName

## Checks not made
- Crossings between arrows in the final layout (requires --svg)
- whether checkedBy really validates its input
- data flow inside a component
