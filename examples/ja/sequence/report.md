# acme シーケンス図：応答の欠落

Reader: 応答を確認する開発者
Question: 要求への応答は返るか？

The model has 2 participants and 3 messages. The chart draws 2 participants and 3 arrows.

## Answered breaks
The path to it has 1 messages, numbered in the order of the chart:
0. 利用者 to acme API: 要求を送る
No later reply answers this call, and the call declares no timeout.

## Marks
- Breaks Answered: a pale red box and a note naming the rule.

## Warnings
None.

## Rules that hold
Declared, ReplyMatches, Recovered, SelfIsSelf, PurposeStated, ProductName

## Checks not made
- whether the order of messages is right for the protocol
- timing beyond the declared timeouts
- whether parallel branches can really run together
