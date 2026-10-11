# Choose evidence for the requirement

A correct HTTP response can accompany an incorrect state change or a forbidden
external call. Select observations that answer the specific question in the requirement.

![A valid cache hit and a cache bypass return the same product, but only the latter reads PostgreSQL.](../assets/guides/product-cache-evidence.svg)

## Responses, state, and interactions

| Evidence                           | Question                      | Limitation                                                       |
| ---------------------------------- | ----------------------------- | ---------------------------------------------------------------- |
| Response status and body           | What did the caller receive?  | Does not establish persistence or downstream completion.         |
| Independent database or cache read | What state was visible?       | Does not identify every operation used to produce it.            |
| Observed runtime operation         | What did the observer record? | An attempted SQL write may roll back; capture may be incomplete. |

Use only the observations needed by the requirement. A database assertion is not
mandatory for a response-only rule, and an effects matcher cannot replace an
independent state read when the claim concerns committed data.

## Why absence is harder than presence

“No PostgreSQL read on a valid cache hit” requires more than no SQL spans. The
service might be uninstrumented or the capture window incomplete.

A credible absence check needs:

1. A known valid cached value before the action.
2. An observer shown to detect a relevant database read.
3. A bounded window covering the selected retrieval and its completion.
4. A way to distinguish application traffic from setup, inspection, and concurrent work.

The [product-cache case study](../guides/verify-a-specification.md) proposes
calibration and application-role counters for an isolated request. It is an
observation design, not an included counter implementation. A positive control
supports the tested observation path; it cannot guarantee coverage of arbitrary
libraries or future paths.

## Wait for the right completion condition

An HTTP response, broker acknowledgment, and completed business operation are
different events. For asynchronous work, use the matching business identity and
the deadline permitted by the requirement. Do not add polling to conceal a
violation of a promise that the result is already available when the response arrives.

Same-Sandbox membership or overlapping timestamps do not by themselves establish
causality. Keep scope, identifiers, and capture limitations with the result.
[Completion guide](../guides/testing-async-flows.md).

## Interpret an execution

Effect assessments distinguish `pass`, `fail`, and `inconclusive`. The
`toSatisfy` matcher succeeds only when the contract is established; missing or
incomplete evidence remains inconclusive, including under negation. Playwright
reports the outcomes of its assertions, and an early failure can prevent later
assertions from running.

Effects are projected from OpenTelemetry observations. An observed operation does
not prove durable state, and an empty observation set is not a successful absence
check.

[Reports](../guides/reports.md) · [Review changes](../contracts/reviewing-changes.md) ·
[Effects snapshots](../contracts/effects-snapshots.md)
