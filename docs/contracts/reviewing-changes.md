# Review changes to expected behavior

A failed assertion is a discrepancy to investigate. Decide whether the
implementation, the requirement, or the observation needs to change before
editing an expectation.

| Situation                                 | Review action                                                                   |
| ----------------------------------------- | ------------------------------------------------------------------------------- |
| Implementation violates accepted behavior | Repair code and rerun unchanged assertions.                                     |
| Intended behavior changed                 | Review the requirement, scenarios, and assertions together.                     |
| Observer changed                          | Check whether it still measures the same action and outcome.                    |
| Observation is incomplete                 | Repair capture or report that the claim was not established.                    |
| Internal refactor preserves behavior      | Keep expectations; avoid making incidental internal calls part of the contract. |

For a cache-hit requirement, changing an expected database-read count from zero
to one would conceal the defect. Conversely, changing how the observer identifies
application SQL may be necessary if the application's instrumentation changed.
Keep the reason and resulting scope explicit.

## Give the repair a fixed target

Supply the exact failed attempt, requirement, and observed discrepancy:

```text
A valid cached retrieval must avoid PostgreSQL. The API returned the right
product, but the observation recorded an application database read.
Investigate the implementation and the observer. Preserve the accepted
expectation, repair the cause, and rerun. Propose any requirement change
separately and explain why it is needed.
```

## Keep the decision reviewable

Preserve the failed and repaired reports with their revision and attempt identities.
Explain which assertions ran and whether any later checks were left unexecuted.
Record why a deliberately changed expectation matches the revised requirement.
An agent's explanation should link to runtime evidence rather than replace it.

In the candidate Feature workflow, regenerating TypeScript updates a derived
artifact. Review the Feature's meaning first, then validate generation and execute
the suite. Arbitrarily edited native tests do not have byte-level compiler equivalence.

Apply the same review discipline to [effects baselines](effects-snapshots.md).
Review changes to effect selection, normalization, and accepted constraints;
a newly recorded interaction does not automatically become expected behavior.

[Reports](../guides/reports.md) · [CI](../guides/ci-verification.md) ·
[Behavioral contracts](README.md)
