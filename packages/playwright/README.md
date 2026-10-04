# Blackbox Playwright

`@suites/blackbox/playwright` groups native Playwright tests by a catalog system
and Sandbox configuration. Every physical test attempt, including a retry, runs
in a fresh Sandbox. Tests keep their native Playwright callbacks, hooks, steps,
reporters, and parallel scheduling.

## Install

Install Playwright with the main Blackbox package and its optional physical
Playwright adapter:

```sh
npm install --save-dev @suites/blackbox@next @suites/blackbox-playwright@next @playwright/test
```

Application code imports the adapter through the `@suites/blackbox/playwright`
paths below. Installing `@suites/blackbox` alone does not install or load the
optional adapter.

## Use

Configure the catalog once in `playwright.config.ts`. The path is resolved
relative to that file. Test files then select a system or subsystem and declare
one or more named Sandbox configurations.

```ts
import { defineConfig } from '@suites/blackbox/playwright/config';

export default defineConfig({
  blackboxConfigFile: './blackbox.config.yaml',
  testDir: './tests/system',
  fullyParallel: true,
  reporter: [
    ['list', { printSteps: true }],
    [
      '@suites/blackbox/playwright/reporter',
      {
        sandboxLifecycle: true,
      },
    ],
    ['html', { open: 'never' }],
  ],
});
```

```ts
import { expect, test } from '@suites/blackbox/playwright';

test.system('subscription-system', (system) => {
  system.sandbox('default', { environment: { FEATURE_MODE: 'stable' } }, (suite) => {
    suite.describe('health', () => {
      suite.test('reports ready', async ({ request, sandbox, telemetry, effects }) => {
        const url = new URL('/health', sandbox.entrypoint.url).href;
        const response = await test.step('When health is requested', () => request.get(url));

        expect(response.ok()).toBe(true);
        expect(sandbox.catalogEntry.id).toBe('subscription-system');
        expect(telemetry.executionId).toBe(sandbox.executionId);
        expect(effects.executionId).toBe(sandbox.executionId);
      });
    });
  });
});
```

This is a breaking migration from the flat fixture API. Replace
`test.use({ catalogEntry, blackboxEnvironment })` plus root `test(...)` calls with
`test.system(...).sandbox(...)` groups, and pass `blackboxEnvironment` as the
Sandbox option `{ environment: blackboxEnvironment }`. Relative `request` and
`page` URLs no longer target the Sandbox automatically; resolve them explicitly
against `sandbox.entrypoint.url`. Playwright's root `baseURL` remains whatever the
project configured.

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
per-test hook callbacks receive the normal Playwright fixtures plus `sandbox`,
`telemetry`, and `effects`. Continue to use `test.step(...)` for native steps.
Sandbox-scoped `beforeAll` and `afterAll` hooks are unavailable because there is
no group-level live Sandbox. Root Playwright `beforeAll` and `afterAll` hooks can
still perform setup unrelated to a Sandbox.

The fixture always requests Sandbox cleanup after the test body. Assertion
failure, timeout, skip, and interruption are retained as distinct cleanup
reasons. Setup failure also attempts cleanup before surfacing the error.

## Fixtures

- Playwright's configured `baseURL` remains unchanged. Build request and page
  URLs explicitly with `new URL(path, sandbox.entrypoint.url).href`.
- `sandbox` exposes read-only attempt, catalog, entrypoint, container, and
  artifact identity. Lifecycle control remains fixture-owned.
  `sandbox.exec(participant, argv)` runs a setup command inside a participant
  container and records it as a linked activity (see [Setup commands](#setup-commands)).
- `telemetry` exposes the attempt identity, live collector status, and raw
  retained session or trace reads.
- `effects` exposes the attempt identity and the contract-evaluation boundary.
  `expect(effects).toSatisfy(...)` compiles and delegates an immutable contract,
  but the Alpha does not yet project raw telemetry into normalized effects. The
  matcher therefore reports an inconclusive failure unless an evaluator is
  supplied by the runtime.

## Setup commands

`sandbox.exec(participant, argv)` runs `argv` in the Compose service of the
catalog participant `participant` (its key under `participants`, as in a driver
target), with stdin closed, and resolves when the command exits. Like
`capsule run`, every command is an activity with its own ID and W3C trace:

- the command receives that trace as `TRACEPARENT`, so instrumented processes it
  starts join the trace;
- a `playwright.exec` root span with `blackbox.activity.id`,
  `blackbox.activity.purpose` (`setup`) and `blackbox.participant` is exported to
  the attempt's collector, and `rootSpan` says whether the collector accepted it;
- the attempt document records `activity` events with the activity ID,
  participant, executable, argument count, trace ID and exit code. Arguments are
  not recorded, because setup arguments often carry credentials.

```ts
suite.test('seeds a user before logging in', async ({ sandbox, telemetry }) => {
  const seeded = await sandbox.exec('user', ['sh', '-c', './seed-user.sh']);
  expect(seeded.exitCode, seeded.stderr).toBe(0);
  const trace = await telemetry.readTrace(seeded.traceId);
  // ...
});
```

The result also carries `stdout` and `stderr` (at most 1 MiB each). A non-zero
exit code is returned, not thrown; a command that cannot start (an undeclared
participant, a missing executable) rejects. Commands are not routed through
catalog drivers: `capsule run --via <driver>` driver preparation is not available
to Playwright tests yet.

## Execution reporting

Playwright's native reporter owns test progress, steps, colors, errors, and the
final summary. The example above has this native title hierarchy:

```text
system "subscription-system"
└─ sandbox "default"
   └─ health
      └─ reports ready
         └─ When health is requested
```

The grouping does not change the existing `blackbox-progress`,
`blackbox-attempt`, or `blackbox-diagnostics` attachments. Blackbox also adds two
short messages through the test's captured stdout, so Playwright associates them
with the right parallel attempt:

```text
Blackbox: sandbox ready for system "subscription-system"
... native Playwright test and step output ...
Blackbox: sandbox cleaned up for system "subscription-system"
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
export default defineConfig({
  blackboxConfigFile: './blackbox.config.yaml',
  use: { blackboxRetainAttempts: true },
});
```

After cleanup, each attempt is copied to
`.blackbox/experiments/<sandboxId>/` (a `playwright-<uuid>` directory) beside
`blackbox.config.yaml`: `attempt.json` holds the final attempt document and
`sandbox/` the sandbox record and retained telemetry. Retention is off by default,
never overwrites an existing directory, and fails the attempt if it cannot write.
`capsule report` does not read these directories yet.

The retained telemetry summary reads request/span counters from the lifecycle
record without loading raw trace fragments. Collector shutdown is reported from
its retained status. Neither a span count nor a
completed collector shutdown proves that a business workflow finished; the test
must await its completion boundary before asserting behavior. Effect contract
diagnostics will be added with the effect evaluator.

Effect projection, accepted baselines, drivers, and shared worker
sandboxes are intentionally outside this package's current surface.
