# Run your first system test

Create an item through HTTP, retrieve it, and inspect a Playwright report. Blackbox
will start a fresh service for the test and release it afterward.

Complete [package installation](installation.md#install-the-playwright-package),
then work in the new `blackbox-first-test` project. Docker
must be running. No typed-client candidate API or Feature compiler is required.

## 1. Create the application

Create `app.mjs`:

```js
import { createServer } from 'node:http';

const items = new Map();

const server = createServer((request, response) => {
  response.setHeader('content-type', 'application/json');
  if (request.method === 'GET' && request.url === '/health') {
    response.end(JSON.stringify({ ready: true }));
  } else if (request.method === 'POST' && request.url === '/items') {
    const item = { id: 'item-1', name: 'Field notebook' };
    items.set(item.id, item);
    response.writeHead(201);
    response.end(JSON.stringify(item));
  } else if (request.method === 'GET' && request.url === '/items/item-1') {
    const item = items.get('item-1');
    response.writeHead(item ? 200 : 404);
    response.end(JSON.stringify(item ?? { error: 'not-found' }));
  } else {
    response.writeHead(404);
    response.end(JSON.stringify({ error: 'not-found' }));
  }
});
server.listen(3000, '0.0.0.0');
process.once('SIGTERM', () => server.close());
```

The service stores one item in memory and closes its listener when the container
receives a stop signal. The rule is: **creating an item returns
`201`, and a subsequent retrieval returns the created item**. This example does
not claim database durability or runtime-effect coverage.

Create `compose.yaml`:

```yaml
services:
  api:
    image: node:22-bookworm-slim
    working_dir: /app
    command: [node, /app/app.mjs]
    volumes:
      - ./app.mjs:/app/app.mjs:ro
```

Blackbox publishes the catalog entrypoint on an available host port. Leave `ports`
out of this Compose file; tests obtain the mapped URL from the attempt.

## 2. Declare the system

Create `blackbox.config.yaml`:

```yaml
schemaVersion: 1
catalog:
  default: items
  entries:
    items:
      kind: system
      acquisition:
        adapter: docker-compose@1
        files: [compose.yaml]
      entrypoint:
        participant: api
        protocol: http
        containerPort: 3000
        readiness:
          path: /health
          timeoutMs: 60000
      participants:
        api:
          service: api
          role: entrypoint
          runtime: node
      drivers: {}
      observation:
        policyId: response-only
        boundaries: []
        requiredBoundaries: []
        terminalObservationWindowMs: 0
        redaction:
          requestBodies: not-captured
          headers: [authorization, cookie]
          dynamicIdentifiers: not-captured
```

This catalog names the Compose service and its readiness endpoint. It declares
no instrumentation activations or required observation boundaries. The test checks
HTTP behavior directly. [Configuration reference](configuration.md).

Validate it with the project-local CLI:

```sh
npx blackbox catalog validate --json
```

Expect `"ok": true`. Validation checks configuration and referenced files; it does
not start the service or establish that the business rule passes.

## 3. Write the test

Create `playwright.config.ts`:

```ts
import { defineConfig } from '@suites/blackbox-playwright/config';

export default defineConfig({
  blackboxConfigFile: './blackbox.config.yaml',
  testDir: './tests',
  workers: 1,
  retries: 0,
  timeout: 180_000,
  reporter: [
    ['list', { printSteps: true }],
    ['@suites/blackbox-playwright/reporter', { sandboxLifecycle: true }],
    ['html', { open: 'never' }],
  ],
});
```

Create a `tests` directory and save `tests/items.spec.ts`:

```ts
import { expect, test } from '@suites/blackbox-playwright';

test.system('items', (system) => {
  system.sandbox('default', (suite) => {
    suite.test('a created item can be retrieved', async ({ request, sandbox }) => {
      const url = (path: string) => new URL(path, sandbox.entrypoint.url).href;
      const product = { id: 'item-1', name: 'Field notebook' };

      await test.step('Given the item does not exist', async () => {
        expect((await request.get(url('/items/item-1'))).status()).toBe(404);
      });
      await test.step('When the item is created', async () => {
        const created = await request.post(url('/items'));
        expect(created.status()).toBe(201);
        expect(await created.json()).toEqual(product);
      });
      await test.step('Then retrieval returns that item', async () => {
        const retrieved = await request.get(url('/items/item-1'));
        expect(retrieved.status()).toBe(200);
        expect(await retrieved.json()).toEqual(product);
      });
    });
  });
});
```

The test acts through HTTP. It owns its initial state because its Sandbox starts
a new application process. `request` is Playwright's ordinary fixture; its URLs
explicitly target this attempt's entrypoint.

## 4. Discover, execute, and inspect

```sh
npx playwright test --list
npx playwright test
npx playwright show-report
```

Discovery should list **one test**. Execution should show a ready Sandbox, three
named steps, a passing test, and successful cleanup. The first run may take longer
while Docker downloads images. Blackbox manages startup and teardown; do not start
this Compose project separately.

Open the test in the HTML report. Inspect its assertions and the
`blackbox-diagnostics` attachment. Later invocations replace the default report;
copy it elsewhere if you need to preserve it. [Read reports](guides/reports.md).

## 5. See the test detect a defect

In `app.mjs`, remove `items.set(item.id, item)`, then rerun:

```sh
npx playwright test
```

Creation still returns the expected body and status. Retrieval should fail with
`404` instead of `200`. Restore the removed line and rerun the same test. Keep the
expected result unchanged: the failure is in the application's behavior.

These are expected tutorial outcomes, not a saved run receipt. The
[product-cache case study](guides/verify-a-specification.md) extends this idea to
checks that need independent state reads and runtime observations.

## Resolve a first-run failure

| Symptom                        | Next step                                                                                               |
| ------------------------------ | ------------------------------------------------------------------------------------------------------- |
| No test found                  | Check `tests/items.spec.ts` and `testDir`; run `--list` again.                                          |
| Catalog rejected               | Check YAML indentation, the system ID, and `compose.yaml`.                                              |
| Acquisition or readiness fails | Inspect `blackbox-diagnostics`, Docker access, image pulls, and `/health`.                              |
| Assertion fails                | Compare the reported response with the named step before editing expectations.                          |
| Cleanup fails                  | Preserve the diagnostics and investigate the reported resources; cleanup is part of the attempt result. |

Next, [connect your application](playwright/connect-your-application.md) or
[write more native scenarios](playwright/README.md).
