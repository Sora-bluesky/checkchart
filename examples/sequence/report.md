# acme receives requests

Reader: A maintainer
Question: How does a request receive a result or recover?

The model has 3 participants and 8 messages. The chart draws 3 participants and 7 arrows.

## Warnings
None.

## Rules that hold
Declared, Answered, ReplyMatches, Recovered, SelfIsSelf, PurposeStated, ProductName

## Checks not made
- whether the order of messages is right for the protocol
- timing beyond the declared timeouts
- whether parallel branches can really run together
