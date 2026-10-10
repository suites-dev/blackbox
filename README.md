<p align="center">
  <img width="80" src="https://raw.githubusercontent.com/suites-dev/suites/master/logo.png" alt="Suites logo" />
</p>

<h1 align="center">Suites / Blackbox</h1>

**Spec-Driven Verification for agentic software engineering.**

Blackbox is a **system testing framework for developers and coding agents**. As agents write and
rewrite more code, we need a repeatable way to check that the running system still does what we
intended.

Start with an accepted specification. Let your agent prepare the relevant real system, turn its
behavior into executable Playwright checks, and inspect the results. **The implementation can
change. The accepted behavior must still hold.**

[Give your agent a specification](#give-your-agent-a-specification) ·
[Developer walkthrough](docs/guides/from-spec-to-verification.md) · [Docs](docs/README.md)

## Why Blackbox?

**The application runs its implementation. The test interacts with the application.** Blackbox tests
enter through the running system's I/O interfaces, such as its HTTP API. They exercise the real
services and resources needed for the behavior, then check outputs, stored state, and relevant
runtime interactions.

That boundary gives Blackbox its name. The test sends a request to the product API instead of
importing `ProductService` and calling its methods. An agent can reorganize classes or replace an
ORM while the same checks remain useful, provided the agreed interfaces and behavior stay the same.

You may already call these integration tests. Blackbox gives coding agents the system setup,
isolation, investigation, and reporting workflow to repeat them against an accepted specification.
Client bindings and observation setup may still need maintenance; that is different from changing
what counts as correct behavior.

[How system boundaries keep expectations independent of implementation](docs/concepts/spec-driven-verification.md#why-the-testing-boundary-matters)

## One rule, verified against the running system

> Creating a product persists it in PostgreSQL and populates Redis. Retrieving it while its cached
> entry is valid returns the cached product without reading PostgreSQL.

The test creates and retrieves the product through HTTP, inspects stored state, and observes
database and cache operations. A broken cache bypass can return the same product while violating the
rule:

<p align="center">
  <img width="900" src="docs/assets/guides/product-cache-evidence.svg" alt="The test enters product-service through HTTP. The real system includes PostgreSQL and Redis. Creation checks both stored values; cached retrieval checks the response and operations. A cache bypass returns the same product but reads PostgreSQL and fails the rule." />
</p>

Runtime observations, including OpenTelemetry where instrumented, help establish what happened.
**The specification determines which observations become assertions.** A trace may help diagnose a
failure without making every internal span part of the contract. A missing SQL span alone does not
establish that no database read occurred.

[How the example checks its evidence](docs/concepts/behavioral-evidence.md) ·
[Complete product-cache walkthrough](docs/guides/verify-a-specification.md)

## From specification to repeatable verification

Agree on the behavior, let the agent prepare and explore the relevant system, then preserve the
checks so another implementation can be verified against the same expectations.

<p align="center">
  <img width="900" src="docs/assets/readme/spec-to-verification-workflow.svg" alt="Developer supplies a specification and reviews the agent's proposed expectations. The agent discovers the required system and can investigate it in a Capsule with its own report. Generated or authored Playwright tests run in a fresh Sandbox, produce an HTML report, and guide implementation repair and reruns." />
</p>

Capsules give the agent a place to investigate uncertain actions and observations. Playwright makes
accepted checks repeatable in a fresh Sandbox. They are separate executions; a known system can go
straight to Playwright.

The figure shows the **target workflow**.
[The step-by-step guide](docs/guides/from-spec-to-verification.md) distinguishes available
operations from planned automation.

## Give your agent a specification

Bring a Markdown requirement, acceptance criteria, API contract, or a specification from an SDD
tool. With compatible Blackbox packages installed, add its skills to your agent:

```sh
pnpm exec blackbox skills install blackbox --codex
pnpm exec blackbox skills install discovery --codex
pnpm exec blackbox skills install catalog --codex
pnpm exec blackbox skills install capsule --codex
```

Use your agent's host option in place of `--codex`. Then give it the specification:

```text
Use Suites Blackbox to verify this specification.
Draft reviewable behavioral scenarios and show them to me for approval.
Discover the real services, entrypoints, and observations needed to check them.
Reuse or create the Blackbox configuration and clients. Use a Capsule to
investigate unclear behavior and show me its report when useful.
Turn the approved expectations into Playwright checks, run them, and show
the HTML report and anything still unverified. Repair the implementation
and rerun against the same expectations.
```

Your agent handles discovery and setup. You review the behavior and results. The work produces
**reviewed scenarios, system configuration, client bindings, executable checks, and execution
reports**. The [onboarding guide](docs/playwright/connect-your-application.md) explains these
artifacts and the skills behind them.

## Keep the behavior visible in the tests

Blackbox adopts **Gherkin from Cucumber** for its readable `Feature → Rule → Scenario` structure.
Blackbox's constrained step vocabulary supplies executable meaning. A Feature remains useful across
internal rewrites because its expectations describe system behavior; Gherkin syntax alone does not
prevent stale specifications.

These **candidate-alpha excerpts** show the cache-hit part of the rule. Both omit the earlier setup
that calibrates the observer, creates the product, and checks its PostgreSQL and Redis state. They
are not standalone tests. See the
[complete Feature](docs/features/drafting-feature-files.md#review-the-feature-rule-and-scenarios)
and [native walkthrough](docs/guides/verify-a-specification.md#native-playwright).

```gherkin
@system:product-system @sandbox:default
Feature: Product creation and retrieval
  Rule: Persist products and serve valid cache entries
    Scenario: Retrieve a product from its valid cache entry
      # Arrange: calibration and persisted/cache state checks omitted here.
      Given client "api" has sent POST "/fixture/observations/start" with JSON and received 200:
        """json
        { "productId": "product-1" }
        """
      When client "api" sends GET "/products/product-1"
      Then the response status is 200
      And the response JSON contains:
        """json
        { "id": "product-1", "name": "Field notebook", "priceCents": 1299 }
        """
      And client "api" GET "/fixture/observations/result" returns 200 with JSON exactly:
        """json
        {
          "productId": "product-1",
          "applicationPostgresSelects": 0,
          "applicationPostgresStatements": 0,
          "applicationPostgresPlans": 0,
          "redisGets": 1,
          "retrievals": 1
        }
        """
```

<details>
<summary>The same rule in native Playwright</summary>

```ts
import { expect, test } from '@suites/blackbox-playwright';
import { api } from './clients.js';

const product = { id: 'product-1', name: 'Field notebook', priceCents: 1299 };

test.system('product-system', (system) => {
  system.sandbox('default', { clients: { api } }, (suite) => {
    suite.describe('Feature: Product creation and retrieval', () => {
      suite.describe('Rule: Persist products and serve valid cache entries', () => {
        suite.test(
          'Scenario: Retrieve a product from its valid cache entry',
          async ({ clients, step }) => {
            // Arrange: calibration and persisted/cache state checks omitted here.
            await step('Given a bounded observation of this retrieval', async () => {
              const started = await clients.api.post('/fixture/observations/start', {
                data: { productId: product.id },
              });
              expect(started.status()).toBe(200);
            });

            // Act through the running application's API.
            const response = await step('When the product is retrieved once', () =>
              clients.api.get('/products/product-1'),
            );

            // Assert the accepted outcome and runtime behavior.
            await step(
              'Then the cached product is returned without a PostgreSQL read',
              async () => {
                expect(response.status()).toBe(200);
                expect(await response.json()).toMatchObject(product);
                const inspection = await clients.api.get('/fixture/observations/result');
                expect(inspection.status()).toBe(200);
                expect(await inspection.json()).toEqual({
                  productId: product.id,
                  applicationPostgresSelects: 0,
                  applicationPostgresStatements: 0,
                  applicationPostgresPlans: 0,
                  redisGets: 1,
                  retrievals: 1,
                });
              },
            );
          },
        );
      });
    });
  });
});
```

The `/fixture/` endpoints are sample-owned observation support. They expose real state and operation
measurements over HTTP; they are not built-in Blackbox APIs. The complete example establishes the
observation's scope before using a zero count as evidence.

</details>

Both forms preserve the rule, scenario nesting, and **Arrange → Act → Assert** sequence. There are
two ways to maintain them:

**Compile a reviewed Feature.** Supported sentences generate native Playwright tests. Regenerate and
validate alignment with the Feature; keep generated output unedited.
[Feature compilation](docs/features/generating-test-suites.md).

**Author native Playwright.** Gherkin is optional. Use clients and assertions directly when the
behavior needs richer interactions, and review the test against the accepted specification. A
separate editable-scaffold generator is planned. [Native authoring](docs/playwright/README.md).

## Inspect, repair, verify again

Playwright starts a fresh Sandbox for each test attempt. Its HTML report presents test steps,
assertion outcomes, and Blackbox diagnostics. If the cache rule fails, the agent can investigate the
database access, repair the implementation, and run the same checks again.

<p align="center">
  <img width="790" src="docs/assets/readme/human-agent-verification-loop.svg" alt="The developer approves behavior; the agent implements, inspects execution feedback, repairs the implementation, and reruns the same expectations." />
</p>

A specification can evolve through review. An implementation should not redefine it accidentally. A
passing test supports the behavior it checked under that execution's conditions.

[Run the product-cache walkthrough](docs/guides/verify-a-specification.md) ·
[Repair from evidence](docs/guides/repair-from-evidence.md)

## Alpha and further guides

The typed clients and Feature compiler were implemented in
[PR #181](https://github.com/suites-dev/blackbox/pull/181), which is merged but not included on this
docs branch. The product-cache sample is also unpublished. Automated Feature drafting, direct
Feature execution in Capsules, and scaffold generation are planned. The examples describe the
intended experience, not an end-to-end run verified from this checkout.

[Why verification matters now](docs/concepts/why-verification-now.md) ·
[Systems and clients](docs/playwright/connect-your-application.md) ·
[Capsules](docs/guides/investigate-with-capsule.md) ·
[Evidence](docs/concepts/behavioral-evidence.md) · [Contributing](CONTRIBUTING.md) ·
[License](LICENSE)
