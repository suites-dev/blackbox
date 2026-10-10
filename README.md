<p align="center">
  <img width="80" src="https://raw.githubusercontent.com/suites-dev/suites/master/logo.png" alt="Suites logo" />
</p>

<h1 align="center">Suites / Blackbox</h1>

**A system testing framework for executable specifications and runtime verification, built for developers and coding
agents.**

Blackbox turns accepted specifications into repeatable verification against real applications and subsystems. Developers
and coding agents express the expected behavior, execute it, inspect the evidence, and repair the implementation against
the same accepted expectations.

Playwright runs the tests. Blackbox gives each attempt a fresh isolated **Sandbox**: it builds and starts the configured
system, connects the test's clients, collects execution diagnostics, and releases the environment afterward. Tests can
combine response assertions, stored-state checks, and supported runtime observations, including OpenTelemetry.

## Spec-Driven Verification

A specification can be a product requirement, acceptance criteria, an API contract, a Markdown document, or any other
source of agreed behavior. The developer and agent turn that intent into executable expectations for review, then check
them against the running system.

Consider one rule: **creating a product persists it in PostgreSQL and populates Redis. Retrieving it while cached must
use Redis without reading PostgreSQL.** A correct HTTP response alone cannot establish that rule. The test also needs
evidence of the stored values and the operations performed during retrieval.

<p align="center">
  <img width="800" src="docs/assets/guides/product-cache-journey.svg" alt="An accepted product requirement guides agent setup and reviewed expectations, written directly in native Playwright or through an optional Feature. Both run in a fresh Sandbox and produce assertion results, runtime observations, and diagnostics." />
</p>

Specs become stale when they lose their connection to the implementation. Blackbox keeps their accepted expectations
in the verification loop: review checks that the tests preserve the intended behavior, and repeated execution exposes
departures from it. A passing suite establishes its assertions; review still determines whether those assertions cover
the specification.

## Get started

**Follow the product example.** [Verify a specification](docs/guides/verify-a-specification.md) follows the PostgreSQL and
Redis rule from the accepted document through a system test, its evidence, and a repair. The guide includes source-checkout
prerequisites and lets you choose native Playwright or optional Feature authoring.

**Bring your application.** [Connect your application](docs/playwright/connect-your-application.md) guides your coding
agent through discovery, configuration, and the first business scenario using your project's services and SDKs.

These guides target the candidate alpha and require implementation and sample files that are pending in this checkout.
Check [current availability](#alpha-and-further-guides) before following their execution steps.

## Your agent handles the setup

Blackbox's skill system guides your agent through repository discovery. The agent derives the system topology, chooses
the application or subsystem needed to verify the requirement, and creates the necessary configuration and supporting
files. `blackbox.config.yaml` selects the boundary, startup definitions, and observation setup; client definitions
connect the tests to its services.

With the [required packages and agent skills](docs/playwright/connect-your-application.md#prepare-the-test-project) available,
give your agent the accepted specification and ask:

> Set up Blackbox to verify this specification. Discover our services and dependencies, derive the system topology,
> and create or update the configuration. Prepare the business scenarios for review and identify the evidence each
> claim needs.

You can also configure Blackbox and write tests directly; agent assistance is optional.
The setup produces a runnable system boundary and tests tied to the accepted behavior. During each Playwright attempt,
the Sandbox owns the configured build, startup, client readiness, and cleanup.

[See the setup workflow and resulting files](docs/playwright/connect-your-application.md#let-the-agent-discover-and-configure-the-boundary).

## Express the accepted behavior

Blackbox adopts Gherkin from Cucumber for behavior-driven development: **Feature → Rule → Scenario** keeps the capability,
business rule, and concrete examples together. **Given → When → Then** follows Arrange, Act, Assert. You can use this
structure directly in native Playwright or author an optional `.feature` file that generates the suite.

### Native Playwright

Write TypeScript with your project's SDKs and ordinary assertions. This creation scenario checks the response and both
stored values under the accepted rule. The example's `api` client connects to the Sandbox's `product-service`.

```ts
import { expect, test } from '@suites/blackbox-playwright';
import { api } from './clients.js';

const product = { id: 'product-1', name: 'Field notebook', priceCents: 1299 };

test.system('product-system', (system) => {
  system.sandbox('default', { clients: { api } }, (suite) => {
    suite.describe('Feature: Product creation and retrieval', () => {
      suite.describe('Rule: Persist products and serve valid cache entries', () => {
        suite.test('Scenario: Create a new product', async ({ clients, step }) => {
          await step('Given the product does not exist', async () => {
            const state = await clients.api.get('/fixture/products/product-1');
            expect(state.status()).toBe(200);
            expect(await state.json()).toEqual({ postgres: null, redis: null });
          });
          const response = await step('When the product is created', () =>
            clients.api.post('/products', { data: product }),
          );
          await step('Then the product is returned, persisted, and cached', async () => {
            expect(response.status()).toBe(201);
            expect(await response.json()).toMatchObject(product);
            const state = await clients.api.get('/fixture/products/product-1');
            expect(state.status()).toBe(200);
            expect(await state.json()).toEqual({ postgres: product, redis: product });
          });
        });
      });
    });
  });
});
```

The `/fixture/` endpoint belongs to this example application and reads its actual PostgreSQL and Redis state.
The [complete walkthrough](docs/guides/verify-a-specification.md) adds a separate cache-hit scenario: it establishes its
own product, checks that the observer detects a database read, then verifies cached retrieval without one.

### Optional Feature files

The same creation scenario can be reviewed as Gherkin. Blackbox generates native Playwright while preserving the
Feature, Rule, and Scenario nesting and the authored step order.

```gherkin
@system:product-system @sandbox:default
Feature: Product creation and retrieval
  Rule: Persist products and serve valid cache entries
    Scenario: Create a new product
      Given client "api" GET "/fixture/products/product-1" returns 200 with JSON exactly:
        """json
        { "postgres": null, "redis": null }
        """
      When client "api" sends POST "/products" with JSON:
        """json
        { "id": "product-1", "name": "Field notebook", "priceCents": 1299 }
        """
      Then the response status is 201
      And the response JSON contains:
        """json
        { "id": "product-1", "name": "Field notebook", "priceCents": 1299 }
        """
      And client "api" GET "/fixture/products/product-1" returns 200 with JSON exactly:
        """json
        {
          "postgres": { "id": "product-1", "name": "Field notebook", "priceCents": 1299 },
          "redis": { "id": "product-1", "name": "Field notebook", "priceCents": 1299 }
        }
        """
```

The current compiler uses a [defined HTTP vocabulary](docs/features/reference.md#sentence-reference). Native tests can
use SDK operations beyond that vocabulary. Both paths use the same Sandbox lifecycle and Playwright reporting.
For generated suites, a drift check also verifies that the TypeScript still matches the reviewed Feature.

[Write native tests](docs/playwright/README.md) ·
[Review the full Feature and generated suite](docs/features/drafting-feature-files.md) ·
[Keep generated suites in sync](docs/features/generating-test-suites.md)

## Developer-agent verification loop

The developer approves the specification, expected outcomes, and verification policy. The agent prepares tests,
implements the behavior, inspects failures, and repairs the implementation against those same expectations.

<p align="center">
  <img width="800" src="docs/assets/readme/human-agent-verification-loop.svg" alt="The developer approves intent and policy. The agent implements and repairs the system using Blackbox execution results and evidence. Proposed changes to accepted expectations return to the developer for review." />
</p>

Playwright reports keep the authored steps and assertion results together with Blackbox's attempt diagnostics.
In the [repair walkthrough](docs/guides/repair-from-evidence.md), the HTTP response remains correct while runtime
observations reveal an unnecessary PostgreSQL read. The agent repairs the cache path and reruns the same tests.

For interactive investigation, a **Capsule** provides a controlled environment to act on the system, inspect evidence,
and test a hypothesis. Its recorded activities and observations remain available after the environment stops.
Use the [Capsule experiment workflow](packages/capsule/skills/capsule/references/capsule-experiments.md) when a failure
needs further investigation. New expectations return to review before joining the specification.

Evidence must support the claim: a database operation does not establish a commit, and a missing span does not establish
that no operation occurred. See [how to read and retain evidence](docs/guides/verify-a-specification.md#read-the-evidence).
Local iteration and CI rerun the same accepted expectations; [Feature maintenance](docs/features/generating-test-suites.md)
adds generated-suite drift checks where needed.

## Alpha and further guides

Blackbox is under active development. These guides describe the candidate alpha: the Feature compiler and typed
Playwright client API depend on [the pending Feature implementation](https://github.com/suites-dev/blackbox/pull/181).
The product example is not yet included in this checkout; its walkthrough requires that sample to land as well.
Automatic Feature drafting, completed-run Feature verification, and Feature coverage remain under development.

Continue with the [documentation journey](docs/README.md), or go directly to the evidence your claim needs:
[HTTP responses](docs/guides/testing-http-apis.md), [PostgreSQL state](docs/guides/testing-postgres.md),
[Redis behavior](docs/guides/testing-redis.md), and [bounded asynchronous outcomes](docs/guides/testing-async-flows.md).
For configuration and commands, see the [client reference](docs/playwright/clients-and-fixtures.md),
[Catalog](packages/catalog/README.md), and [CLI reference](packages/cli/README.md).
