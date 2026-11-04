# acme architecture: outside input

Reader: A developer checking input validation
Question: Where is data from outside checked?

The model has 2 components and 1 connections. The chart draws 2 components and 1 arrows.

## TrustChecked breaks
The shortest path has 1 step:
0. Sender (untrusted, inside Outside)
1. Sends input: acme API (trusted)
Nothing checks what acme API receives from untrusted content.

## Warnings
None.

## Rules that hold
EndsDeclared, Connected, PurposeStated, NoRedundantContainer, ArrowsLabeled, ProductName

## Checks not made
- whether checkedBy really validates its input
- data flow inside a component
