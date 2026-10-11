# Behavioral contracts

A behavioral contract records what must remain true when the implementation
changes: the result returned to the caller, required state changes, and any
interactions constrained by the requirement.

For example, a product may need to be stored in PostgreSQL and Redis, while a
later valid cache hit must avoid PostgreSQL. Those are three distinct claims.

| Artifact             | Role                                                                                |
| -------------------- | ----------------------------------------------------------------------------------- |
| Accepted requirement | Defines intended behavior and conditions.                                           |
| Native test          | Establishes initial state, acts through I/O, and asserts the selected expectations. |
| Optional Feature     | Expresses selected examples in the candidate compiler's supported vocabulary.       |
| Effects baseline     | Preserves reviewed expectations about the scenario's runtime interactions.          |
| Run record           | Retains observed results and diagnostics from one execution.                        |

An observation does not become an expectation just because a run succeeded.
Reviewers decide which behavior to preserve.

## Keep expectations stable through a refactor

A test that enters through HTTP can keep the same response and state assertions
when the application changes its internal classes. Client bindings, fixtures,
and instrumentation may still need maintenance. Review those changes so they
continue to measure the same claim.

Use independent state reads when persistence matters. Use scoped runtime
observation when the rule constrains an interaction. A successful response alone
cannot establish either. [Choosing evidence](../concepts/behavioral-evidence.md).

## Review intentional behavior changes

When a requirement changes, review the source requirement and its assertions
together. When an implementation violates the existing requirement, repair it
and rerun the same assertions. The [review guide](reviewing-changes.md) covers
observer changes and incomplete evidence too.

## Review the effects baseline

[Effects snapshots](effects-snapshots.md) preserve selected runtime observations
for review. Accept expectations against the requirement, then check fresh
observations with the same effect contract. Keep response and state assertions
alongside it. A recorded effect is evidence of an operation, not proof that a
write committed or background work completed.

[Write a native test](../playwright/README.md) ·
[Requirement workflow](../guides/from-spec-to-verification.md)
