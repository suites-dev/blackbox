# Playwright

Blackbox groups native Playwright tests by a Catalog system and a named Sandbox configuration. Each physical test attempt runs in a fresh Sandbox, while Playwright keeps its runner, assertions, steps, scheduling, and reports.

## Choose how to author

Write native tests when code is the clearest expression of the check. Use the [Feature compiler](../specifications/index.md) when a reviewed executable specification is the useful authoring boundary. The generated path does not replace the native path.

```ts
import { expect, test } from '@suites/blackbox-playwright';

test.system('subscription-system', (system) => {
  system.sandbox('default', (suite) => {
    suite.test('health responds', async ({ request, sandbox }) => {
      const response = await request.get(new URL('/health', sandbox.entrypoint.url).href);
      expect(response.status()).toBe(200);
    });
  });
});
```

## What Blackbox adds

The fixture resolves the catalog, acquires the selected environment, activates configured instrumentation, waits for readiness, and supplies attempt-scoped Sandbox and telemetry handles. It requests cleanup after the test, including failure paths.

The adapter does not silently replace your `baseURL`, start a shared environment for all tests in a group, or turn raw telemetry into a complete behavioral proof.

## Learn the pieces

[Systems and Sandboxes](system-and-sandbox.md) explains grouping and lifecycle. [Writing tests](writing-tests.md) covers state, asynchronous completion, and useful assertions. [Execution and retries](execution-and-retries.md) covers physical attempts. [Reports](reports.md) explains the retained results. [CI](ci.md) covers scope, resource limits, generated-suite consistency, and runner policy.

For signatures, use the [Playwright API reference](../reference/playwright-api.md).

## Source contract

[Implementation](https://github.com/suites-dev/blackbox/blob/9197de5de456285af16e4dcbcf722082217a3989/packages/playwright/README.md).

## Pages in this section

- [Systems and Sandboxes](system-and-sandbox.md)
- [Writing system tests](writing-tests.md)
- [Execution and retries](execution-and-retries.md)
- [Playwright reports](reports.md)
- [CI verification](ci.md)

---

[Documentation](../README.md)
