# acme 構成図：外部入力

Reader: 入力の検証を確認する開発者
Question: 外部のデータはどこで検証されるか？

The model has 2 components and 1 connections. The chart draws 2 components and 1 arrows.

## TrustChecked breaks
The shortest path has 1 step:
0. 送信元 (untrusted, inside 外部)
1. 入力を送信する: acme API (trusted)
Nothing checks what acme API receives from untrusted content.

## Warnings
None.

## Rules that hold
EndsDeclared, Connected, PurposeStated, NoRedundantContainer, ArrowsLabeled, ProductName

## Checks not made
- whether checkedBy really validates its input
- data flow inside a component
