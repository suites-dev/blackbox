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

export default defineConfig({
  blackboxConfigFile: './blackbox.config.yaml',
  testDir: './tests/system',
  reporter: [['@suites/blackbox-playwright/reporter'], ['html', { open: 'never' }]],
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

The fixture always requests Sandbox cleanup after the test body. Assertion
failure, timeout, skip, and interruption are retained as distinct cleanup
reasons. Setup failure also attempts cleanup before surfacing the error.

## Fixtures

- Playwright's `request` and `page` use the selected entrypoint as `baseURL`.
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

The text reporter prints startup events as they happen: catalog resolution,
container states, instrumentation verification, and application readiness. It
also displays nested `test.step()` calls and reports the final test outcome
after teardown. Every line identifies its attempt so parallel tests and retries
remain distinguishable.

Fixtures attach sanitized `blackbox-progress` events and a final
`blackbox-attempt` JSON document to Playwright results, including failures.
Other Playwright reporters retain these attachments too. Startup observations
are bounded; the attempt document records how many were omitted.

The telemetry summary describes retained requests, spans, and traces. Collector
shutdown is reported from its retained status. Neither a trace count nor a
completed collector shutdown proves that a business workflow finished; the test
must await its completion boundary before asserting behavior. Effect contract
diagnostics will be added with the effect evaluator.

Effect projection, accepted baselines, drivers, and shared worker
sandboxes are intentionally outside this package's current surface.
