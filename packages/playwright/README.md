# Blackbox Playwright

`@suites/blackbox-playwright` runs each physical Playwright test attempt in a
fresh Sandbox selected from the project's Blackbox catalog. It composes native
Playwright fixtures; it does not wrap the Playwright runner or share application
state between tests.

## Use

Configure the catalog once in `playwright.config.ts`. The path is resolved
relative to that file; every test still selects its system or subsystem.

```ts
import { defineConfig } from '@suites/blackbox-playwright/config';
import type { BlackboxReporterOptions } from '@suites/blackbox-playwright/reporter';

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
      } satisfies BlackboxReporterOptions,
    ],
    ['html', { open: 'never' }],
  ],
});
```

```ts
import { expect, test } from '@suites/blackbox-playwright';

test.use({
  catalogEntry: { kind: 'system', id: 'subscription-system' },
});

test('reports ready', async ({ request, sandbox, telemetry, effects }) => {
  const response = await request.get('/health');
  expect(response.ok()).toBe(true);
  expect(sandbox.catalogEntry.id).toBe('subscription-system');
  expect(telemetry.executionId).toBe(sandbox.executionId);
  expect(effects.executionId).toBe(sandbox.executionId);
});
```

The selected ID must exist in `blackbox.config.yaml`, and its declared kind must
match `system` or `subsystem`. The catalog is resolved for every physical
attempt, including retries. Setup starts
the catalog-selected Compose services, installs the current Node activation
adapter where configured, starts the collector, verifies activation, waits for
application readiness, and then enters the test body.

Acquisition is bounded by the configured test timeout but runs outside the test
body's budget, so a slow catalog entry never shortens the time left for the body.

The fixture always requests Sandbox cleanup after the test body. Assertion
failure, timeout, skip, and interruption are retained as distinct cleanup
reasons. Setup failure also attempts cleanup before surfacing the error.

## Fixtures

- Playwright's `request` and `page` use the selected entrypoint as `baseURL`.
- `sandbox` exposes read-only attempt, catalog, entrypoint, container, and
  artifact identity. Lifecycle control remains fixture-owned.
- `telemetry` exposes the attempt identity, live collector status, and raw
  retained session or trace reads.
- `beforeAll` and `afterAll` hooks run outside any test attempt, so they never
  acquire a sandbox. There, `baseURL` (and so `request`) keeps the configured
  value, and `sandbox`, `telemetry` and `effects` fail with an error that names
  the hook. Use `beforeEach`, `afterEach` or the test body for sandbox work.
- `effects` exposes the attempt identity and the contract-evaluation boundary.
  `expect(effects).toSatisfy(...)` compiles and delegates an immutable contract,
  but the Alpha does not yet project raw telemetry into normalized effects. The
  matcher therefore reports an inconclusive failure unless an evaluator is
  supplied by the runtime.

## Execution reporting

Playwright's native reporter owns test progress, steps, colors, errors, and the
final summary. Blackbox adds two short messages through the test's captured
stdout, so Playwright associates them with the right parallel attempt:

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
Each event carries the `sandboxId` that owns it once the sandbox identity exists,
and `blackbox-diagnostics` prefixes those lines with `[<sandboxId>]`.
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
