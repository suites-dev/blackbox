# Verify the behavior while an agent changes the code

A coding agent can produce implementation and tests together. A useful review
still needs an independently agreed answer to “what should this system do?”
Keep that answer visible in the assertions and the evidence from each execution.

## Give the repair a stable target

Suppose the rule forbids PostgreSQL reads during a valid cache hit. An agent can
rewrite the cache implementation, but the no-read expectation should stay fixed
unless the requirement deliberately changes.

```text
Accepted requirement → reviewed assertions → execution → evidence
                              ↑                         ↓
                              └──── repair and rerun ──┘
```

The [behavioral contract](../contracts/README.md) records those expectations.
Blackbox runs the selected system; the test acts through its interfaces. The agent
can inspect source during discovery and repair without making private method
structure the criterion for correct business behavior.

## Ask for observations, not confidence

A report should identify the test, revision, initial state, executed assertions,
and observed values. A correct response cannot establish every downstream claim.
An early failing assertion may leave later checks unexecuted.

A [Capsule](../guides/investigate-with-capsule.md) can help investigate an unknown.
A fresh Playwright attempt must reproduce the final check with its own state and
evidence. [Evidence guidance](behavioral-evidence.md) explains absence and completion.

## Keep the workflow reusable

Reuse suitable catalog entries, startup definitions, and observers across scenarios.
Keep the verification boundary small enough to repeat while retaining the real
participants needed to answer the requirement. Disclose substitutions and external
services that limit isolation.

Finite system tests establish selected behavior under observed conditions. They do
not prove all possible inputs or replace review of an incomplete requirement.

[Turn a requirement into a test](../guides/from-spec-to-verification.md) ·
[Review changes](../contracts/reviewing-changes.md) · [Run the tutorial](../getting-started.md)
