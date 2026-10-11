# Spec-Driven Verification

A specification states intended behavior. A test turns selected parts of that
intent into executable expectations. Running the test produces evidence about
whether those expectations held for that execution.

Consider: **creating a product persists it and populates Redis; retrieving it
from a valid cache entry must not read PostgreSQL.** The response can be correct
while the no-read requirement fails.

![The same response can conceal a database read that violates the cache rule.](../assets/guides/product-cache-evidence.svg)

## Why the testing boundary matters

Blackbox starts the selected system and tests it through I/O such as HTTP.
The test does not instantiate an application business class to invoke it. This
allows internal code to change while interface behavior remains the test's target.

Teams may call these system, integration, or E2E tests. The useful questions are
where the test enters, which real dependencies run, and what the assertions can
observe. Client bindings, fixtures, and instrumentation can still need maintenance.

## Keep three relationships explicit

| Relationship                        | How to check it                                       |
| ----------------------------------- | ----------------------------------------------------- |
| Source requirement → assertions     | Review meaning, preconditions, and omitted cases.     |
| Optional Feature → generated suite  | Candidate compiler validation compares derived bytes. |
| Assertions → running implementation | Execute the test with adequate observations.          |

Neither successful compilation nor a passing execution proves that all source
requirements were represented. A report supports the assertions that actually ran
under its recorded conditions.

## Choose an authoring path

[Native Playwright](../playwright/README.md) is available in this checkout and
supports project-owned TypeScript. The optional
[Feature compiler](../features/README.md) requires a candidate implementation
outside this branch. Its supported HTTP sentences generate a suite that stays
unedited. Gherkin is not required for native tests.

The [behavioral contract](../contracts/README.md) is the set of reviewed
expectations. Raw telemetry is evidence, not automatically an accepted baseline.
Use [effects snapshots](../contracts/effects-snapshots.md) to review runtime
observations and preserve the expectations subsequent runs must satisfy.

## Preserve intent while investigating

A Capsule can help find a useful observation or diagnose a failure. A final
Playwright test must establish its own preconditions and collect fresh evidence.
Repairing a defect should not silently change the accepted requirement.

Finite tests cover selected inputs and conditions; they do not establish formal
correctness for every execution. Missing instrumentation and incomplete background
work can limit a conclusion even when the response looks right.

[Choose evidence](behavioral-evidence.md) ·
[Follow a requirement](../guides/from-spec-to-verification.md) ·
[Verification with agents](why-verification-now.md)
