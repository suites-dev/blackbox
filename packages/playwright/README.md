# Blackbox Playwright

`@suites/blackbox-playwright` groups native Playwright tests by a catalog system
and Sandbox configuration. Every physical test attempt, including a retry, runs
in a fresh Sandbox. Tests keep their native Playwright callbacks, hooks, steps,
reporters, and parallel scheduling.

## Install

Install the Blackbox adapter with Playwright:

```sh
npm install --save-dev @suites/blackbox-playwright@next @playwright/test
```

Application code imports directly from the adapter paths below.

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

```ts
import { expect, test } from '@suites/blackbox-playwright';

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
- `telemetry` exposes the attempt identity, live collector status, and raw
  retained session or trace reads.
- `effects` exposes the attempt identity and the contract-evaluation boundary.
  `expect(effects).toSatisfy(...)` compiles and delegates an immutable contract,
  but the Alpha does not yet project raw telemetry into normalized effects. The
  matcher therefore reports an inconclusive failure unless an evaluator is
  supplied by the runtime.

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

The retained telemetry summary reads request/span counters from the lifecycle
record without loading raw trace fragments. Collector shutdown is reported from
its retained status. Neither a span count nor a
completed collector shutdown proves that a business workflow finished; the test
must await its completion boundary before asserting behavior. Effect contract
diagnostics will be added with the effect evaluator.

Effect projection, accepted baselines, drivers, and shared worker
sandboxes are intentionally outside this package's current surface.

## Runner policy

Timeouts, retries, projects, and test selection decide what a green run means,
so the Blackbox reporter prints the effective runner policy on stderr at the
start of every run and attaches the same text to each attempt as
`blackbox-policy`. The policy is what Playwright resolved from the config, CLI
flags such as `--retries`, `--timeout`, `--grep`, `--project`, and `--shard`,
and test declarations such as `test.describe.configure`:

- run settings: `failOnFlakyTests`, `forbidOnly`, `fullyParallel`,
  `globalTimeout`, `grep`/`grepInvert`, `maxFailures`, `shard`, `workers`;
- per project: `retries`, `timeout`, expect timeout, `repeatEach`,
  `grep`/`grepInvert`, `testDir`, `testMatch`, `testIgnore`;
- the Sandbox cleanup timeout;
- every selected test with its own `retries` and `timeout`.

The expect timeout is known only when the config uses `defineConfig` from
`@suites/blackbox-playwright/config`; otherwise it is recorded as `null`.

To verify the policy, commit a baseline and name it in the reporter options:

```ts
[
  '@suites/blackbox-playwright/reporter',
  {
    policy: {
      baseline: './blackbox.policy.json',
      outputFile: './test-results/blackbox-policy.json',
    },
  },
],
```

Both paths resolve from the config directory. `outputFile` writes the effective
manifest. Any difference from the baseline, or a missing or malformed baseline,
prints one line per difference and fails the run, even when every test passed.
`playwright test --list` performs the same check without running tests. To
accept a change, copy the written manifest's `schemaVersion` and `policy` over
the baseline in a reviewed change; `argv` is printed and written but never
compared, because it holds machine paths and its effect is already in the
policy. Protect the baseline like test code, for example with CODEOWNERS.
Sharded CI jobs select different tests, so give each shard its own baseline.
