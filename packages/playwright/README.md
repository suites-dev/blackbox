# Blackbox Playwright

`@suites/blackbox-playwright` runs each physical Playwright test attempt in a
fresh Sandbox selected from the project's Blackbox catalog. It composes native
Playwright fixtures; it does not wrap the Playwright runner or share application
state between tests.

Until the alpha is published, install it and its Blackbox dependencies from source as
described in [installation](../../docs/installation.md#install-the-playwright-package-from-source).

## Use

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

Effect projection, accepted baselines, drivers, reports, and shared worker
sandboxes are intentionally outside this package's current surface.
