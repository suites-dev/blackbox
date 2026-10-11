# Connect your application

Replace the tutorial's service with your application and the dependencies needed
to test one accepted behavior. The result is a named system that native Playwright
can start, exercise, and clean up for each attempt.

Start with a working [first test](../getting-started.md) and
[package installation](../installation.md). This guide uses the native API in this
checkout. [Typed clients](clients-and-fixtures.md) require a separate candidate build.

## 1. Choose the behavior and boundary

For a product creation rule, identify the HTTP action, required stored state,
and the moment those results must be visible. Include the API and the actual
PostgreSQL and Redis participants if they are part of that behavior.

| Decision        | Example                                                      |
| --------------- | ------------------------------------------------------------ |
| Entry action    | `POST /products`.                                            |
| Initial state   | A known product ID is absent.                                |
| Expected result | `201` plus independently observed database and cache values. |
| Completion      | The response means both writes have finished.                |

Keep unrelated services out only when doing so preserves the behavior and needed
observations. Record any external services or substitutes. Review the expected
outcomes before using them to judge the implementation.

## 2. Prepare startup and readiness

Reuse existing Compose files where suitable. Each attempt needs its own resources
and known initial state. The application owns migrations, credentials, seed data,
and health checks. Blackbox owns acquisition and teardown of the selected system.

Adapt the tutorial's [catalog](../getting-started.md#2-declare-the-system):

- Set `acquisition.files` to the project-relative Compose files.
- Map each participant to its Compose service.
- Set the entrypoint's participant, container port, and readiness endpoint.
- Add instrumentation activations only when you have installed their actual assets.

The [configuration reference](../configuration.md) links the complete schema.
A catalog observation policy describes intended boundaries; it does not supply
instrumentation or prove that a runtime interaction was captured.

## 3. Validate the configuration

From the application test-project root, use the project-local CLI:

```sh
npx blackbox catalog validate --json
npx blackbox catalog ls --json
```

Expect `"ok": true` and the intended catalog ID in the list. Resolve invalid paths,
missing files, and incompatible activation adapters before running a scenario.

## 4. Address the current attempt

Configure `blackboxConfigFile` and reporters as in the tutorial. In the test,
select the matching catalog ID and build URLs from the current entrypoint:

```ts
import { expect, test } from '@suites/blackbox-playwright';

test.system('product-system', (system) => {
  system.sandbox('default', (suite) => {
    suite.test('the API is ready', async ({ request, sandbox }) => {
      const response = await request.get(new URL('/health', sandbox.entrypoint.url).href);
      expect(response.status()).toBe(200);
    });
  });
});
```

Replace the ID and path with your catalog and health contract. Discover and run
this test from your test-project root:

```sh
npx playwright test --list
npx playwright test
npx playwright show-report
```

A ready Sandbox and passing health check establish connectivity. Now add the
business assertions; a readiness-only suite has not verified the product rule.

## 5. Add the accepted scenario

Establish its initial state, act through the application interface, and observe
the required result. Read state through a project-owned inspection endpoint or
an independently managed SDK connection. Do not copy the creation response into
an endpoint that is supposed to inspect the stored row.

Native Playwright fixtures can manage project-specific connections. The
candidate `defineClient` registry is another approach, but is unavailable in this
branch. See [native authoring](README.md) and the
[product-cache case study](../guides/verify-a-specification.md) for evidence design.

## Let the agent discover and configure the boundary

[Install the agent skills](../agent-skills.md) before asking the agent to inspect
your repository. A useful task is:

> Verify this accepted behavior with Blackbox. Reuse suitable Compose and catalog
> files. Map each claim to an action, observation, and completion condition.
> Propose the tests for review, run them, inspect failures, and report any claim
> the execution did not establish. Keep accepted expectations fixed during repair.

Repeatable setup can serve many scenarios. A new requirement does not need a
second infrastructure stack when the existing boundary is sufficient.

[Reports](../guides/reports.md) · [CI verification](../guides/ci-verification.md) ·
[Agent skills](../agent-skills.md)
