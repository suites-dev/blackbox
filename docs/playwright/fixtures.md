# Native Playwright fixtures and lifecycle

This page describes the API in this checkout. The candidate `defineClient`,
typed `clients`, and injected `step` APIs have a
[separate reference](clients-and-fixtures.md).

## Declare tests

Import `test` and `expect` from `@suites/blackbox-playwright`. Call
`test.system(id, callback)`, then `system.sandbox(name, options?, callback)`.
A string selects `kind: system`; use `{ kind: 'subsystem', id }` for a subsystem.
Declaration callbacks must be synchronous.

Inside the Sandbox declaration, use `suite.describe`, `suite.test`,
`suite.beforeEach`, and `suite.afterEach`. Test and per-test hook callbacks can
be asynchronous. Use `test.step(...)` for named Playwright steps.

## Fixtures

| Fixture                                             | What it exposes                                                                                |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `request`, `page`, and ordinary Playwright fixtures | Normal Playwright behavior. The project's configured `baseURL` is unchanged.                   |
| `sandbox`                                           | Read-only attempt identity, catalog selection, entrypoint, containers, and artifact directory. |
| `telemetry`                                         | Collector status and raw session/trace reads for this attempt.                                 |
| `effects`                                           | Evaluation of effect contracts against runtime observations selected for this attempt.         |

Build an application URL with `new URL(path, sandbox.entrypoint.url).href`.
The test fixture owns lifecycle; it does not expose a shared mutable Sandbox.
Use `expect(effects).toSatisfy(...)` for runtime-interaction assertions. Missing or
incomplete evidence remains inconclusive. The first tutorial uses response
assertions because its service has no instrumentation activation.
[Effects and evidence](../contracts/effects-snapshots.md).

## Attempt lifecycle

```text
Acquire configured system → verify activation and readiness
    → run per-test hooks and test → release system → attach diagnostics
```

Each physical attempt, including a retry, starts a fresh Sandbox. Declaration
groups do not share live state. Sandbox-scoped `beforeAll` and `afterAll` are
unavailable. Root Playwright hooks may perform setup unrelated to a Sandbox.
Cleanup is requested after failures, timeouts, skips, interruptions, and setup
failures. Cleanup errors remain visible in the result.

Pass Compose substitution values through the Sandbox `environment` option.
The [package reference](../../packages/playwright/README.md#use) describes
redaction and the migration from the earlier flat fixture API.

## Reports and retention

The Blackbox reporter adds `blackbox-diagnostics`; fixtures supply
`blackbox-progress` and `blackbox-attempt`. Add an HTML or JSON Playwright reporter
to retain the result in the format your workflow needs.

`use: { blackboxRetainAttempts: true }` copies each finished attempt to
`.blackbox/experiments/<sandboxId>/` beside the catalog, with `attempt.json`
and `sandbox/`. It is off by default. A retention failure fails the attempt.
This does not archive the HTML report, and Capsule report commands do not read
these saved Playwright attempts.

[Read reports](../guides/reports.md) · [Package details](../../packages/playwright/README.md) ·
[Write a scenario](README.md)
