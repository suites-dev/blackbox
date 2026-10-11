# Turn an accepted requirement into a system test

Use this workflow after [running the first test](../getting-started.md). It helps
you decide what to run, what to observe, and how to judge the result.

## 1. Translate the requirement into concrete checks

For the rule “creation persists the product and populates Redis,” choose a product
ID, initial state, action, and expected database and cache values. For “a valid
cache hit must not read PostgreSQL,” choose an observer that can detect that read.

Review this mapping before execution:

| Claim                           | Action                                 | Observation                              | Completion                                                      |
| ------------------------------- | -------------------------------------- | ---------------------------------------- | --------------------------------------------------------------- |
| Persist the product             | Create through HTTP                    | Read the committed row independently     | Creation response, if the rule promises synchronous persistence |
| Populate Redis                  | Same creation                          | Read the expected cache entry            | Same completion boundary                                        |
| Avoid PostgreSQL on a cache hit | Retrieve once with a valid cache entry | Calibrated, bounded database observation | The retrieval and required observation window are complete      |

These are separate questions. A passing HTTP assertion alone cannot answer all
of them. [Choose evidence](../concepts/behavioral-evidence.md).

## 2. Prepare the relevant system

Reuse startup definitions and a catalog entry containing the participants the
scenario needs. Establish migrations, readiness, and known initial state.
Keep substitutions and external dependencies visible.

[Connect your application](../playwright/connect-your-application.md).

If the behavior or observer is unfamiliar, use a [Capsule](investigate-with-capsule.md)
to investigate it. The final test still needs its own state and fresh observations.

## 3. Author the executable expectations

Use [native Playwright](../playwright/README.md) in this checkout. Name setup,
action, and assertion steps; keep accepted values separate from observed results.

The optional [Feature compiler](../features/README.md) requires the candidate
implementation outside this branch. Generated suites stay unedited; project-owned
native suites are edited normally. Neither route establishes that every clause
of the source specification has been covered.

## 4. Discover, execute, and inspect

From the configured test-project root:

```sh
npx playwright test --list
npx playwright test
npx playwright show-report
```

Check the discovery list, actual executed assertions, observed values, and cleanup
outcome. A later assertion skipped because an earlier one threw remains unchecked.
Use the [report guide](reports.md) to distinguish startup, test, and cleanup failures.

## 5. Repair or review the intended change

If the implementation violates the accepted behavior, repair it and rerun the
same assertions. If the requirement changed, review the requirement and assertions
together. If the observer cannot establish the claim, repair that observation
before treating the result as conclusive.

[Contract review](../contracts/reviewing-changes.md) · [CI](ci-verification.md) ·
[Product-cache case study](verify-a-specification.md)
