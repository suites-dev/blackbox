# Write native Playwright system tests

Use native tests when you want to author actions and assertions in TypeScript.
Blackbox starts the selected system for each physical attempt; Playwright runs
your test and reports the result.

Complete [the first system test](../getting-started.md) or
[connect your application](connect-your-application.md) before following this guide.

## Keep the requirement visible

Write one scenario around a concrete behavior. Name setup, action, and assertion
steps so a report explains what was checked:

```ts
import { expect, test } from '@suites/blackbox-playwright';

test.system('items', (system) => {
  system.sandbox('default', (suite) => {
    suite.describe('Rule: created items can be retrieved', () => {
      suite.test('Scenario: retrieve a newly created item', async ({ request, sandbox }) => {
        const url = (path: string) => new URL(path, sandbox.entrypoint.url).href;
        await test.step('Given an item was created', async () => {
          expect((await request.post(url('/items'))).status()).toBe(201);
        });
        await test.step('Then its data is available', async () => {
          const response = await request.get(url('/items/item-1'));
          expect(response.status()).toBe(200);
          expect(await response.json()).toEqual({ id: 'item-1', name: 'Field notebook' });
        });
      });
    });
  });
});
```

This example uses the tutorial's `items` system. Feature/Rule/Scenario naming is
optional for authored tests. A source specification or Gherkin file is not a
runtime prerequisite; the reviewer still needs to understand the expected behavior.

## Establish state in each scenario

Tests and retries receive fresh Sandboxes. Create required records within the
attempt rather than relying on a preceding test. Use `suite.beforeEach` for shared
preparation that must run for every scenario, and `suite.afterEach` for associated
cleanup. A declaration group has no shared live Sandbox.

Database seeding must commit before the application reads it. A transaction on
the test connection cannot roll back work committed by the application. If a
participant remains external, plan explicit state ownership and cleanup.

## Choose observations for the requirement

| Requirement            | Suitable check                                                                            |
| ---------------------- | ----------------------------------------------------------------------------------------- |
| Return an item         | HTTP status and response fields.                                                          |
| Persist an item        | Independent read through the application's state interface or a database client.          |
| Avoid a database read  | A scoped observer that can detect a forbidden read, with a demonstrated positive control. |
| Finish background work | A matching business completion condition within the accepted deadline.                    |

The last two require more than a response or an empty trace. See
[evidence](../concepts/behavioral-evidence.md) and
[bounded completion](../guides/testing-async-flows.md).

The ordinary Playwright `request` and `page` fixtures are available. Resolve URLs
against `sandbox.entrypoint.url`; their configured `baseURL` is not rewritten.
For candidate SDK registration through `defineClient`, read
[availability](../alpha-status.md) and [typed clients](clients-and-fixtures.md).

## Run a focused scenario

From the configured test-project root:

```sh
npx playwright test --list
npx playwright test --grep 'retrieve a newly created item'
npx playwright show-report
```

Confirm the intended test was discovered and executed. A failed assertion may
prevent later checks from running. Preserve the failed report before another
invocation replaces it, then repair against the same expected behavior.

[Fixtures and lifecycle](fixtures.md) · [Reports](../guides/reports.md) ·
[CI](../guides/ci-verification.md)
