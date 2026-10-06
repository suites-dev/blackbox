# Systems and Sandboxes

A system selection names a Catalog boundary. A Sandbox declaration names a configuration for tests against that boundary. A live Sandbox belongs to one physical test attempt, not to the declaration callback.

## Select a system or subsystem

```ts
test.system('subscription-system', (system) => {
  system.sandbox('default', (suite) => {
    // Declare tests and per-test hooks here.
  });
});

test.system({ kind: 'subsystem', id: 'payment-mock' }, (system) => {
  system.sandbox('default', (suite) => {
    // The Catalog entry must have kind: subsystem.
  });
});
```

A string selects kind `system`. Use an object for an explicit subsystem. The ID and kind must match the catalog.

## Configure the environment

```ts
system.sandbox('stable', { environment: { FEATURE_MODE: 'stable' } }, (suite) => {
  suite.test('health responds', async ({ request, sandbox }) => {
    const url = new URL('/health', sandbox.entrypoint.url).href;
    const response = await request.get(url);
    expect(response.status()).toBe(200);
  });
});
```

This environment is supplied to the selected Sandbox configuration. Keep secrets in runner-provided values, not source literals. A separate configuration group still creates separate environments per test.

## Hooks

Use `suite.beforeEach` and `suite.afterEach` for work tied to an attempt. The declaration callback is synchronous. Do not open network connections or acquire the system there.

Sandbox-scoped `beforeAll` and `afterAll` are not available because there is no group-level live Sandbox. Root Playwright hooks can do setup unrelated to a Sandbox. Do not hide a shared database fixture in a root hook and assume each attempt remains independent.

## Read-only handle

The `sandbox` fixture exposes IDs, selected catalog metadata, entrypoint, container identities, and the artifact directory. It does not give the test lifecycle ownership. The fixture starts and cleans up resources.

Use `new URL(path, sandbox.entrypoint.url).href` for both requests and pages. Relative URLs still follow the project's normal Playwright configuration.

Next: [Writing tests](writing-tests.md) · [API](../reference/playwright-api.md).

## Source contract

[Types](https://github.com/suites-dev/blackbox/blob/9197de5de456285af16e4dcbcf722082217a3989/packages/playwright/src/types.ts). [Implementation](https://github.com/suites-dev/blackbox/blob/9197de5de456285af16e4dcbcf722082217a3989/packages/playwright/README.md).

---

[Documentation](../README.md)
