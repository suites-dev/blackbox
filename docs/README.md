# Blackbox documentation

**Start with a specification. Let your agent verify its behavior against the running system.**

Blackbox tests enter through the application's I/O interfaces and check required outputs, state, and
runtime interactions. That boundary keeps accepted expectations independent of the internal code an
agent may rewrite.
[Why the name Blackbox matters](concepts/spec-driven-verification.md#why-the-testing-boundary-matters).

![From developer-approved behavior through system preparation and optional Capsule investigation to repeatable Playwright verification.](assets/readme/spec-to-verification-workflow.svg)

## Start here

The [complete developer workflow](guides/from-spec-to-verification.md) follows three stages:

1. **Define:** give the agent an accepted requirement, review its concrete scenarios, and approve
   what should happen. A Gherkin Feature is optional.
2. **Prepare:** let the agent discover the relevant system and reuse or create its configuration.
   When investigation is useful, rehearse the behavior in a Capsule and review its HTML report.
3. **Verify:** create repeatable Playwright tests using either deterministic Feature compilation or
   project-owned TypeScript, then inspect results and repair against unchanged expectations.

**New to Blackbox?** Follow the [product-cache specification](guides/verify-a-specification.md) to
see why a correct HTTP response can still hide an incorrect database read.

## Choose your task

| What you need                                    | Guide                                                                  |
| ------------------------------------------------ | ---------------------------------------------------------------------- |
| Integrate an existing repository                 | [Agent-assisted setup](playwright/connect-your-application.md)         |
| Understand Gherkin and supported steps           | [Feature authoring](features/README.md)                                |
| Compile a reviewed Feature                       | [Generated suite and drift checks](features/generating-test-suites.md) |
| Write project-owned SDK assertions               | [Native Playwright](playwright/README.md)                              |
| Understand the separate editable scaffold design | [Editable scaffolds (planned)](playwright/editable-scaffolds.md)       |
| Discover or investigate with the real system     | [Capsule experiments](guides/investigate-with-capsule.md)              |
| Repair a regression without changing its spec    | [Evidence-led repair](guides/repair-from-evidence.md)                  |

## Why the workflow matters

As coding agents take on more implementation work, **approved specifications become a stable
reference for what the system should do**. Checks must compare that behavior with the actual running
implementation, not just inspect code or trust a green status.

[Why verification matters now](concepts/why-verification-now.md) ·
[Spec-Driven Verification](concepts/spec-driven-verification.md) ·
[What counts as evidence](concepts/behavioral-evidence.md)

For exact interfaces, see [Feature syntax](features/reference.md),
[Playwright clients and fixtures](playwright/clients-and-fixtures.md),
[HTTP](guides/testing-http-apis.md), [PostgreSQL](guides/testing-postgres.md),
[Redis](guides/testing-redis.md), [async completion](guides/testing-async-flows.md), and
[Spec Kit integration](integrations/spec-kit.md).

**Alpha availability:** the Feature compiler and typed Playwright clients from merged
[PR #181](https://github.com/suites-dev/blackbox/pull/181) are not included on this docs branch. The
`e2e/product-cache/` example is unpublished. Automated Feature drafting, direct Feature execution in
a Capsule, and editable scaffold generation are **planned**. See the
[workflow's status notes](guides/from-spec-to-verification.md).
