<p align="center">
  <img width="80" src="https://raw.githubusercontent.com/suites-dev/suites/master/logo.png" alt="Suites logo" />
</p>

<div align="center">
  <a href="https://opensource.org/licenses/Apache-2.0"><img src="https://img.shields.io/badge/license-Apache_2.0-blue.svg" alt="license" /></a>
  <a href="CONTRIBUTING.md"><img src="https://img.shields.io/badge/PRs-welcome-brightgreen.svg" alt="Contributions welcome" /></a>
</div>

<h1 align="center">Suites / Blackbox</h1>

**A system testing framework for executable specifications and runtime verification, built for developers and coding
agents.**

<p align="center">
  <a href="docs/README.md">Docs</a> ·
  <a href="#installation-and-agent-onboarding">Installation</a> ·
  <a href="#quickstart">Quickstart</a> ·
  <a href="docs/guides/README.md">Guides</a>
</p>

Blackbox turns accepted specs into verification against real applications and systems. Its skills and CLI guide
coding agents through setup, execution, investigation, and repair against the same accepted expectations.

Express those expectations in native Playwright tests. An optional Feature-to-Playwright compiler
is documented as a [candidate outside this branch](docs/alpha-status.md).
Blackbox runs the application and its dependencies in a fresh isolated **Sandbox** for each test.

## Blackbox and Spec-Driven Verification

**Spec-Driven Verification checks a running system against an accepted spec.**

Start from product requirements, acceptance criteria, OpenAPI, Markdown, or specs from [spec-driven development (SDD) workflows](docs/integrations/README.md)
such as Spec Kit, Kiro, and OpenSpec. The figure follows the optional Feature-file path to execution and reporting.

<p align="center">
  <img width="800" src="docs/assets/readme/specification-to-evidence.svg" alt="Skills guide Feature drafting; the developer reviews; the CLI compiles; Playwright runs a fresh Sandbox and reports results and evidence." />
</p>

Blackbox's CLI validates system configuration and supports runtime investigation. The candidate compiler adds
test generation. Skills guide the agent through commands and their structured feedback.
**You review the expected behavior; the agent handles the operational work.**

### Specs and Behavioural Contracts

**Specifications in any format can become stale as implementation evolves.**

Blackbox solves this by introducing **Behavioural Contracts** into the verification loop: accepted requirements
expressed as executable expectations about responses, state changes, and runtime interactions. Tests preserve the
contract alongside code. [Effects snapshots](docs/contracts/effects-snapshots.md) support review of runtime expectations and comparison with later runs.

Blackbox takes its name from how tests enter the running application: through I/O such as HTTP or asynchronous messages.
Tests exercise the real system and its dependencies. Accepted expectations stay tied to observable behavior,
so internal code can change while the same contract defines correctness.

## Quickstart

[Install Blackbox](docs/installation.md) and [run your first system test](docs/getting-started.md).
The tutorial includes a small HTTP service, its configuration, a native Playwright test, report
inspection, and a deliberate defect. It uses APIs present in this checkout.

**Alpha availability:** typed client registration and the Feature compiler described below require
[a candidate implementation outside this branch](docs/alpha-status.md). The product-cache application
is a case study whose sample files are not supplied.

### Product-cache example

Give your agent one accepted requirement, for example `specs/create-product.md`:

> Creating a product must persist it in PostgreSQL and populate Redis. Retrieving it while its cached entry is valid
> must return the product without reading PostgreSQL.

The [product-cache case study](docs/guides/verify-a-specification.md) follows it through setup, verification, and repair.

### Installation and Agent Onboarding

<a id="alpha-and-further-guides"></a>

Start onboarding from your application root:

```sh
npx @suites/blackbox-cli@alpha onboarding start
```

Follow the guided workflow to set up your coding agent and prepare the application
for verification. See [onboarding and agent skills](docs/agent-skills.md) for details
or [package installation](docs/installation.md) to install integrations directly.

Blackbox provides a full skill system for setup, authoring, execution, and investigation. The skills supply procedures
and context; the CLI supplies commands and structured feedback. Give your agent a concrete task:

> Use Blackbox to verify `specs/create-product.md`. Propose expectations for my review, prepare the relevant system
> and tests, run them, and show me the report and evidence. Repair failures against the same accepted behavior.

The agent discovers services and dependencies, derives the topology and system boundaries, and creates or updates
`blackbox.config.yaml`, client definitions, and test configuration. You review the proposed expectations before execution.

<p align="center">
  <img width="800" src="docs/assets/readme/onboarding-discovery.svg" alt="Accepted spec and repository lead to skills-guided discovery, a real system boundary, configuration and client files, and CLI validation." />
</p>

### From specification to executable tests

The authoring skills help the agent turn the accepted rule into reviewable tests. **You keep ownership of the expected
behavior.** The examples below use `Feature → Rule → Scenario` nesting and **Arrange → Act → Assert**.
Feature-style naming is optional for native tests.

**Candidate native example.** This scenario expresses the [behavioural contract](docs/contracts/README.md) as response,
effects, and state assertions. It assumes an empty store, configured system, [clients](docs/playwright/clients-and-fixtures.md), and an
[effects evaluator](docs/playwright/clients-and-fixtures.md#inspect-the-attempt).

```ts
import { expect, test } from '@suites/blackbox-playwright';
import { db, redis } from './clients.js';

test.system('product-system', (system) => {
  // Prepare a fresh Sandbox and connect its clients for each test.
  system.sandbox('default', { clients: { db, redis } }, (suite) => {
    suite.describe('Feature: Product creation and retrieval', () => {
      suite.describe('Rule: Persist products and serve valid cache entries', () => {
        suite.test('Scenario: Create a product', async ({ clients, effects, request, sandbox }) => {
          const product = { id: 'product-1', name: 'Field notebook', priceCents: 1299 };
          const key = `product:${product.id}`;
          const url = new URL('/products', sandbox.entrypoint.url).href;
          const response = await test.step('When the product is created', () =>
            request.post(url, { data: product }));

          await test.step('Then return the created product', async () => {
            expect(response.status()).toBe(201);
            expect(await response.json()).toMatchObject(product);
          });

          await test.step('And write the product to the cache', async () => {
            // Effects check the application's runtime interactions.
            await expect(effects).toSatisfy((e) => [
              e.exists(e.cache({ actor: 'product-service', operation: 'SET', target: key })),
            ]);
          });

          await test.step('And persist the product and populate its cache', async () => {
            // Clients inspect state in real dependencies.
            const stored = await clients.db.query(
              'SELECT id, name, price_cents AS "priceCents" FROM products WHERE id = $1',
              [product.id],
            );
            expect(stored.rows).toEqual([product]);
            const cached = await clients.redis.get(key);
            expect(cached).not.toBeNull();
            expect(JSON.parse(cached!)).toEqual(product);
          });
        });
      });
    });
  });
});
```

**Candidate Feature example.** Blackbox adopts Gherkin from Cucumber for readable behavioral specifications.
Its supported HTTP vocabulary gives steps executable meaning. The same creation requirement can be expressed as:

```gherkin
@system:product-system @sandbox:default
Feature: Product creation and retrieval
  Rule: Persist products and serve valid cache entries
    Scenario: Create a product
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

Here, the **example-owned** `/fixture/` route reads real PostgreSQL and Redis state through HTTP. Native tests can
inspect state directly through SDK clients and add runtime assertions, as above.

The agent uses `blackbox feature file validate` to check supported steps and `blackbox feature suite emit` to generate
Playwright tests. Generated suites stay unedited; native suites remain project-owned.
[Feature authoring and commands](docs/features/drafting-feature-files.md).

### Run and inspect the verification

These are normal commands for a configured project. The runnable tutorial uses the native API;
the product-cache examples additionally need their candidate packages and application.

From your test-project root, with the configuration and reviewed suite in place,
use the project-local CLI:

```sh
npx blackbox catalog validate --json
npx playwright test --config playwright.config.ts
npx playwright show-report playwright-report
```

Catalog validation should return `"ok": true`. Playwright runs the tests; Blackbox starts and releases their Sandboxes.
The candidate adapter also connects registered clients. The HTML report shows named steps, assertion results, and Blackbox diagnostics.
For the native creation example, expect a `201` response, the stored product, and the required cache write.

The [case study](docs/guides/verify-a-specification.md#native-playwright) adds cached retrieval. A correct
response can still fail its no-PostgreSQL-read requirement. The agent uses CLI feedback and runtime evidence to
investigate, repair, and rerun against the same expectations. [Read reports](docs/guides/reports.md) ·
[Follow a repair](docs/guides/repair-from-evidence.md).

## Keep the spec connected as code changes

- **Review** checks that executable expectations express the accepted spec.
- **Candidate compiler validation** checks that generated TypeScript still matches its Feature.
- **Execution** checks the running implementation against accepted assertions and effects.

Use the same expectations during local iteration and CI. When intended behavior changes, review the spec and executable expectations together. A failed run should not silently redefine success.

A passing test supports the assertions that ran under the observed conditions. Runtime observations, including
OpenTelemetry, help answer questions beyond the response. The requirement determines which evidence each test needs.

[Spec-Driven Verification](docs/concepts/spec-driven-verification.md) ·
[Evidence](docs/concepts/behavioral-evidence.md) · [CI verification](docs/guides/ci-verification.md)

---

[All docs](docs/README.md) · [Support](https://github.com/suites-dev/blackbox/issues) ·
[Contributing](CONTRIBUTING.md) · [License](LICENSE)
