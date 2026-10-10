# Verification concepts

The specification is the **source of accepted intent**. A test expresses an expectation. An
execution produces observations. Verification connects these, within the limits of the selected
system and the available evidence.

Blackbox preserves the separation between behavior and implementation by testing through the running
system's I/O interfaces. Start with
[why the testing boundary matters](spec-driven-verification.md#why-the-testing-boundary-matters).

- [Why verification matters now](why-verification-now.md) — why faster agent implementation raises
  the value of specs and independently checked behavior.
- [Spec-Driven Verification](spec-driven-verification.md) — what Blackbox means by
  specification-driven checks, review, and implementation conformance.
- [Behavioral evidence](behavioral-evidence.md) — outcomes, state, effects, completion, causality,
  and the limits of absence claims.

Start with the [product-cache walkthrough](../guides/verify-a-specification.md) to see both concepts
under one accepted PostgreSQL/Redis business rule.
