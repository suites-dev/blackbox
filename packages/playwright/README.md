# Blackbox Playwright

`@suites/blackbox-playwright` groups native Playwright tests by a catalog system
and Sandbox configuration. Every physical test attempt, including a retry, runs
in a fresh Sandbox. Tests keep their native Playwright callbacks, hooks, steps,
reporters, and parallel scheduling.

Clients can wrap HTTP, messaging, database, or project-owned SDKs. Start with the
[Playwright guide](../../docs/playwright/README.md) for syntax and configuration,
or [clients and fixtures](../../docs/playwright/clients-and-fixtures.md) for shared
setup. The [testing guides](../../docs/guides/README.md) cover HTTP APIs,
asynchronous flows, and PostgreSQL and Redis seeding and state assertions.

## Prerequisites

This alpha is available in the source workspace. The package requires Node.js
22.15 or later and `@playwright/test` 1.61 or later within major version 1.
The examples assume the Blackbox workspace packages have been built, Docker is
available, and `blackbox.config.yaml` declares the selected system. Application
code imports directly from the adapter paths below.

## Use

Configure the catalog once in `playwright.config.ts`. The path is resolved
relative to that file. Test files then select a system or subsystem and declare
one or more named Sandbox configurations.

```ts
import { defineConfig } from '@suites/blackbox-playwright/config';

export default defineConfig({
  blackboxConfigFile: './blackbox.config.yaml',
  testDir: './tests/system',
  fullyParallel: true,
  reporter: [
    ['list', { printSteps: true }],
    [
      '@suites/blackbox-playwright/reporter',
      {
        sandboxLifecycle: true,
      },
    ],
    ['html', { open: 'never' }],
  ],
});
```

Then [write a native test](../../docs/playwright/README.md#add-clients-and-a-test).
Register your SDK clients in `system.sandbox(...)`; Blackbox readies them before
per-test hooks and disposes them during cleanup. The [async guide](../../docs/guides/testing-async-flows.md)
contains a complete Redis-to-PostgreSQL example.

## Migrate the flat fixture API

Replace
`test.use({ catalogEntry, blackboxEnvironment })` plus root `test(...)` calls with
`test.system(...)` and nested `system.sandbox(...)` groups, and pass `blackboxEnvironment` as the
Sandbox option `{ environment: blackboxEnvironment }`. Relative `request` and
`page` URLs no longer target the Sandbox automatically; resolve them explicitly
against `sandbox.entrypoint.url`. Playwright's root `baseURL` remains whatever the
project configured.

The Sandbox `environment` is the Compose substitution environment for that group.
Progress and diagnostics redact the values of entries whose names mark a credential,
such as `TOKEN`, `PASSWORD`, `SECRET`, `KEY`, `AUTH` or `CREDENTIALS` segments.
Other values, such as a feature flag `TT_PRICE_STOPPED=1`, are shown as given.

A string passed to `test.system(...)` selects a catalog entry with kind `system`.
Use an object to select either kind explicitly:

```ts
test.system({ kind: 'subsystem', id: 'payment-mock' }, (system) => {
  system.sandbox('default', (suite) => {
    suite.test('accepts a payment', async ({ request, sandbox }) => {
      const url = new URL('/v1/payment_intents', sandbox.entrypoint.url).href;
      const response = await request.post(url, {
        data: { paymentMethodId: 'pm_primary', userId: 'alice' },
      });
      expect(response.status()).toBe(201);
    });
  });
});
```

The selected ID must exist in `blackbox.config.yaml`, and its declared kind must
match the selection. `system.sandbox(...)` creates a configuration group, not a
live shared resource. Blackbox resolves the catalog and creates a separate
Sandbox for each physical test attempt. Setup starts the selected Compose
services, installs the current Node activation adapter where configured, starts
the collector, verifies activation, waits for application readiness, and then
enters the native test callback.

The Sandbox declaration callback is synchronous. Use `suite.describe`,
`suite.test`, `suite.beforeEach`, and `suite.afterEach` inside it. Test and
per-test hook callbacks receive the normal Playwright fixtures plus `clients`,
`step`, `sandbox`, `telemetry`, and `effects`. Use the attempt-bound `step(...)`
fixture for native Playwright steps with local asynchronous context. Step titles
alone do not propagate tracing into application requests.
Sandbox-scoped `beforeAll` and `afterAll` hooks are unavailable because there is
no group-level live Sandbox. Root Playwright `beforeAll` and `afterAll` hooks can
still perform setup unrelated to a Sandbox.

The fixture always requests Sandbox cleanup after the test body. Assertion
failure, timeout, skip, and interruption are retained as distinct cleanup
reasons. Setup failure also attempts cleanup before surfacing the error.

## Fixtures

- `clients` exposes the typed clients registered in the Sandbox declaration.
- `step` creates a native Playwright step with context bound to this attempt.
- Playwright's configured `baseURL` remains unchanged. Build request and page
  URLs explicitly with `new URL(path, sandbox.entrypoint.url).href`.
- `sandbox` exposes read-only attempt, catalog, entrypoint, container, and
  artifact identity. Lifecycle control remains fixture-owned.
- `telemetry` exposes the attempt identity, live collector status, and raw
  retained session or trace reads.
- `effects` exposes the attempt identity and the contract-evaluation boundary.
  `expect(effects).toSatisfy(...)` compiles and delegates an immutable contract,
  but the Alpha does not yet project raw telemetry into normalized effects. The
  matcher therefore reports an inconclusive failure unless an evaluator is
  supplied by the runtime.

## Execution reporting

Playwright's native reporter owns test progress, steps, colors, errors, and the
final summary. The async guide produces this title hierarchy:

```text
system "job-system"
└─ sandbox "default"
   └─ processes a queued job
      ├─ Queue a job
      └─ Wait for completion
```

The grouping does not change the existing `blackbox-progress`,
`blackbox-attempt`, or `blackbox-diagnostics` attachments. Blackbox also adds two
short messages through the test's captured stdout, so Playwright associates them
with the right parallel attempt:

```text
Blackbox: sandbox ready for system "job-system"
... native Playwright test and step output ...
Blackbox: sandbox cleaned up for system "job-system"
```

Ready means acquisition, instrumentation, and application readiness have passed.
Cleanup failure prints `sandbox cleanup failed` instead of claiming success.
Set `sandboxLifecycle: false` to suppress these messages while retaining diagnostics.
The option defaults to `true` when the Blackbox reporter is configured; without
that reporter, fixtures do not print lifecycle messages. Use any native reporter
alongside Blackbox. If no terminal reporter is configured, Playwright adds its
default one.

Fixtures attach sanitized `blackbox-progress` events and a final
`blackbox-attempt` JSON document to Playwright results, including failures.
Other Playwright reporters retain these attachments too. Startup observations
are bounded; the attempt document records how many were omitted.
The Blackbox reporter also adds a readable `blackbox-diagnostics` attachment.
Container health polling and detailed startup events stay in these attachments,
not the live console. Native reporters may display attachments for failed tests.

Playwright clears `test-results/` and its HTML report on every run. To keep
attempt evidence across runs, enable retention in the Playwright configuration:

```ts
import { defineConfig } from '@suites/blackbox-playwright/config';

const use = {
  trace: 'retain-on-failure' as const,
  blackboxRetainAttempts: true,
};

export default defineConfig({
  blackboxConfigFile: './blackbox.config.yaml',
  use,
});
```

After cleanup, each attempt is copied to
`.blackbox/experiments/<sandboxId>/` (a `playwright-<uuid>` directory) beside
`blackbox.config.yaml`: `attempt.json` holds the final attempt document and
`sandbox/` the sandbox record and retained telemetry. Retention is off by default,
never overwrites an existing directory, and fails the attempt if it cannot write.
`capsule report` does not read these directories yet.

Retention preserves raw evidence. Open `attempt.json` to inspect the test identity
and recorded events; use the files under `sandbox/` for the sandbox lifecycle and
telemetry. There is no saved-attempt browser or comparison command, and this
option does not archive Playwright's HTML report.

The retained telemetry summary reads request/span counters from the lifecycle
record without loading raw trace fragments. Collector shutdown is reported from
its retained status. Neither a span count nor a
completed collector shutdown proves that a business workflow finished; the test
must await its completion boundary before asserting behavior. Effect contract
diagnostics will be added with the effect evaluator.

Effect projection, accepted baselines, drivers, and shared worker
sandboxes are intentionally outside this package's current surface.
