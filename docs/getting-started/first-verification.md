# First verification

This guide starts after the agent has configured a catalog entry named `subscription-system`. The example verifies only that the selected system answers its health endpoint. Use it to check wiring before adding a business scenario.

## Configure Playwright

```ts
import { defineConfig } from '@suites/blackbox-playwright/config';

export default defineConfig({
  blackboxConfigFile: './blackbox.config.yaml',
  testDir: './tests/system',
  workers: 1,
  reporter: [
    ['list', { printSteps: true }],
    ['@suites/blackbox-playwright/reporter'],
    ['html', { open: 'never' }],
  ],
});
```

The catalog path resolves relative to the Playwright configuration file. Use one worker for the first run so startup and resource use are easy to inspect.

## Write a focused check

Save as `tests/system/health.spec.ts`:

```ts
import { expect, test } from '@suites/blackbox-playwright';

test.system('subscription-system', (system) => {
  system.sandbox('default', (suite) => {
    // Each physical test attempt runs in its own isolated Sandbox.
    suite.test('health responds', async ({ request, sandbox }) => {
      const url = new URL('/health', sandbox.entrypoint.url).href;
      const response = await request.get(url);
      expect(response.status()).toBe(200);
    });
  });
});
```

Resolve URLs through `sandbox.entrypoint.url`. Blackbox does not silently replace Playwright's root `baseURL`. The `sandbox(...)` callback declares configuration; it is not a live shared environment.

## Run and inspect

```sh
npx playwright test tests/system/health.spec.ts
npx playwright show-report
```

Confirm that the named test actually ran, inspect its Sandbox startup and cleanup, and follow the retained attempt diagnostics. A failed setup, failed assertion, and failed cleanup are different findings.

## Add the behavior you care about

Move from reachability to an accepted requirement. For subscription creation, check the response and independently read the saved subscription. For asynchronous work, wait for an application completion condition before checking final state.

Use the [subscription example](../examples/README.md) to see the same claim as Markdown, a Feature, and a native test. The project-owned inspection endpoint and helpers in that example are not automatic Blackbox database access.

Next: [Writing tests](../playwright/writing-tests.md) · [Evidence](../verification/evidence.md).

## Source contract

[Implementation](https://github.com/suites-dev/blackbox/blob/9197de5de456285af16e4dcbcf722082217a3989/packages/playwright/README.md).

---

[Documentation](../README.md)
