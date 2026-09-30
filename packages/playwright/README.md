# Blackbox Playwright

`@suites/blackbox-playwright` runs each physical Playwright test attempt in a
fresh Sandbox selected from the project's Blackbox catalog. It composes native
Playwright fixtures; it does not wrap the Playwright runner or share application
state between tests.

## Use

```ts
import { expect, test } from '@suites/blackbox-playwright';

test.use({
  catalogEntry: { kind: 'system', id: 'subscription-system' },
});

test('reports ready', async ({ request, sandbox, telemetry }) => {
  const response = await request.get('/health');
  expect(response.ok()).toBe(true);
  expect(sandbox.catalogEntry.id).toBe('subscription-system');
  expect(telemetry.executionId).toBe(sandbox.executionId);
});
```

The selected ID must exist in `blackbox.config.yaml`, its declared kind must
match `system` or `subsystem`, and it must declare `per-test` isolation. The
catalog is resolved for every physical attempt, including retries. Setup starts
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

Effects, effect matchers, accepted baselines, drivers, reports, and shared
worker sandboxes are intentionally outside this package's current surface.
