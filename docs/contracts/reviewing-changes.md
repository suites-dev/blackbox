# Review a behavior change, not just a snapshot diff

An effects difference is a question to investigate. It is **not permission to replace the baseline**.
The same rule applies to a changed assertion or Feature scenario.

The snapshot lifecycle below is planned; current tests continue to use their real Playwright
assertions and supported observations.

## Decide what changed

| Situation | Appropriate response |
| --- | --- |
| Implementation violates the accepted behavior | Repair code and rerun unchanged expectations. |
| Intended behavior has deliberately changed | Review the source requirement, scenarios, assertions, and relevant baseline together. |
| Instrumentation or normalization changed | Review observer compatibility; do not silently accept a new product behavior. |
| Observation is incomplete or mis-scoped | Repair observation or report the check as unestablished; do not accept an empty snapshot. |
| Internal refactor preserves the agreed behavior | Keep the same expectations. Incidental internal spans should not force a contract change. |

An effects baseline can add constraints not explicitly stated in the original prose. Review those
as decisions, not as incidental capture output. Not every detail must become a permanent constraint.

## First baseline

Identify the scenario, initial state, selected system and observation scope. Compare the candidate
with the accepted requirement, inspect its outputs and state assertions, and ask whether the
observer could detect the relevant failure. Approval is a deliberate review step. A fresh run
checks reproducibility; it does not prove correctness for every possible execution.

## Give the agent a fixed target

```text
Investigate the failed behavior using this specification and accepted baseline.
Keep the expected output, state assertions, and required effects unchanged.
Distinguish an implementation defect from incomplete or changed observation.
Repair the implementation or test support, rerun, and show both attempts.
Propose any requirement or baseline change separately for review.
```

A known passing response does not authorize accepting new downstream behavior. In the cache example,
changing the expected database count from zero to one would conceal the very defect being tested.

## Preserve evidence of the decision

Keep the old baseline, proposed change, reason, source-specification link, and the run used to assess
it available to reviewers. Failed and repaired executions retain distinct identities. Do not copy
an agent explanation into captured evidence as though the runtime produced it.

**Generated suite updates and effects updates are different.** Regenerating TypeScript from a
reviewed Feature is an artifact operation. Accepting an effects change modifies an expectation about
runtime behavior. Neither operation establishes that a fresh system run passed.

[Behavioral contract](README.md) · [Repair exercise](../guides/repair-from-evidence.md) ·
[CI checks](../guides/ci-verification.md)
