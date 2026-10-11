<p align="center">
  <img width="80" src="https://raw.githubusercontent.com/suites-dev/suites/master/logo.png" alt="Suites logo" />
</p>

<div align="center">
  <a href="https://opensource.org/licenses/Apache-2.0"><img src="https://img.shields.io/badge/license-Apache_2.0-blue.svg" alt="license" /></a>
  <a href="https://github.com/suites-dev/suites/blob/master/CONTRIBUTING.md"><img src="https://img.shields.io/badge/PRs-welcome-brightgreen.svg" /></a>
</div>

<h1 align="center">Suites / Blackbox</h1>

<p align="center">
  <a href="docs/README.md">Docs</a> ·
  <a href="#installation">Installation</a> ·
  <a href="#quickstart">Quickstart</a> ·
  <a href="docs/guides/README.md">Guides</a>
</p>

**A system testing framework for executable specifications and runtime verification, built for developers and coding
agents.**

Blackbox turns accepted specifications into repeatable verification against real applications and subsystems. Coding
agents can execute the specified behavior, inspect what happened, investigate failures, repair the implementation, and
rerun against the same accepted expectations.

Expected behavior can be expressed directly in native Playwright tests or through optional executable Feature files
that generate a native suite. Each test attempt runs in a fresh isolated Sandbox, using response, state, and runtime
evidence to evaluate the specified claims.

## Blackbox and Spec-Driven Verification

Spec-Driven Verification checks a running system against an accepted specification. The source can be product
requirements, acceptance criteria, an OpenAPI contract, a Markdown document, or any other description of agreed behavior.

The workflow below follows a Markdown specification through the optional Feature-file path to system execution
and reporting.

<p align="center">
  <img width="800" src="docs/assets/readme/specification-to-evidence.svg" alt="A developer reviews product-cache.feature against create-product.md. The accepted Feature compiles to product-cache.generated.spec.ts. Playwright runs product-service with PostgreSQL and Redis, then reports scenario results, response, state, runtime evidence, and attempt diagnostics." />
</p>

### Preserve the accepted behavior

Specifications in any format can become stale as implementation evolves. Blackbox keeps their accepted expectations
in the verification loop: review checks that executable expectations preserve the intended behavior, and repeated
execution makes departures from that behavior visible.

Tests exercise the running system through its I/O and check responses, state, and required runtime interactions.
This ties expectations to the system's behavioral contract, so internal code can change while the same accepted
behavior remains the basis for verification.

### From specification to repeatable verification

Give your agent the specification. It proposes expectations for your review, then prepares the relevant application
and dependencies and produces native Playwright tests, authored directly or generated from optional Gherkin Feature
files. Playwright runs the checks in fresh isolated Sandboxes and produces an HTML report with results and Blackbox
runtime evidence. The agent uses that evidence to investigate failures, repair the implementation, and rerun against
the same accepted expectations.

This also fits spec-driven development (SDD) workflows such as Spec Kit, Kiro, and OpenSpec. SDD guides specification,
clarification, planning, and implementation; Blackbox keeps the accepted behavior connected to executable checks
and runtime evidence. [Specifications and SDD workflows](docs/integrations/README.md).

## Installation

Follow the [installation guide](docs/playwright/connect-your-application.md#prepare-the-test-project) for the required
packages and alpha prerequisites. With compatible Blackbox packages installed, add the agent skills from your
test-project root:

```sh
pnpm exec blackbox skills install blackbox --codex
pnpm exec blackbox skills install discovery --codex
pnpm exec blackbox skills install catalog --codex
```

Use `--claude` or `--cursor` instead for your agent. Blackbox's skill system supplies the procedures and context for
setup, execution, investigation, and verification. The CLI returns structured feedback the agent can act on.

## Quickstart

Start with one accepted requirement. The example below uses product creation and retrieval: creating a product must
persist it in PostgreSQL and populate Redis; retrieving a valid cached product must avoid a PostgreSQL read.

Give your agent the path to your specification and a verification task:

```text
Use Blackbox to verify specs/create-product.md.
Propose the behavioral checks for my review.
Prepare the relevant system and the Playwright suite.
Run the checks, show the HTML report, and explain the runtime evidence.
If a check fails, repair the implementation and rerun against the same expectations.
```

Replace `specs/create-product.md` with your specification's path. The
[full product-cache guide](docs/guides/verify-a-specification.md) covers the sample prerequisites, complete tests,
and evidence checks; the [guides index](docs/guides/README.md) covers reporting, repair, and CI.

### Agent Onboarding

During onboarding, the agent inspects the repository, discovers services and dependencies, and derives the system
topology. It identifies useful application and subsystem boundaries, then creates or updates the Blackbox configuration
and supporting files.

<p align="center">
  <img width="800" src="docs/assets/readme/onboarding-discovery.svg" alt="Agent onboarding discovers services and dependencies, derives system boundaries, then creates and validates Blackbox configuration." />
  <br />
  <sub>The agent derives runnable boundaries from the repository’s services and dependencies.</sub>
</p>

### From specification to executable tests

The agent proposes concrete tests for the accepted rule. **You keep ownership of the expected behavior:** review
the tests before using them to judge an implementation.

<p align="center">
  <img width="790" src="docs/assets/guides/authoring-paths.svg" alt="One accepted specification leads to reviewed native Playwright tests or an optional Gherkin Feature. Both execute in a Blackbox Sandbox and share reports." />
</p>

**Option A: a Feature file.** Blackbox adopts Gherkin from Cucumber for its readable
`Feature → Rule → Scenario` structure. Its supported step vocabulary supplies executable meaning
and compiles to native Playwright. This excerpt checks creation; the
[full Feature](docs/features/drafting-feature-files.md) also checks cached retrieval.

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

**Option B: native Playwright.** Gherkin is optional. Write TypeScript using your SDK clients and
ordinary assertions. Here is the same creation scenario, preserving its rule and
**Arrange → Act → Assert** sequence:

<details>
<summary>View the same scenario in native Playwright</summary>

```ts
import { expect, test } from '@suites/blackbox-playwright';
import { api } from './clients.js';

test.system('product-system', (system) => {
  system.sandbox('default', { clients: { api } }, (suite) => {
    suite.describe('Feature: Product creation and retrieval', () => {
      suite.describe('Rule: Persist products and serve valid cache entries', () => {
        suite.test('Scenario: Create a product', async ({ clients }) => {
          // Arrange: a fresh Sandbox; confirm the initial state.
          const product = { id: 'product-1', name: 'Field notebook', priceCents: 1299 };
          const before = await clients.api.get('/fixture/products/product-1');
          expect(before.status()).toBe(200);
          expect(await before.json()).toEqual({ postgres: null, redis: null });

          // Act through the running application.
          const response = await clients.api.post('/products', { data: product });

          // Assert the response and stored state.
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
```

</details>

The `/fixture/` route is **example-owned observation support**: it reads real PostgreSQL and Redis
state. The [complete native suite](docs/guides/verify-a-specification.md#native-playwright) adds the
cached-retrieval check.

Generated suites preserve the Feature's nesting and steps and stay unedited. Native suites are
project-owned code. Both run against the same system-testing model.

### Run and inspect the verification

Each Playwright attempt gets a fresh **Sandbox**. Blackbox starts the selected real application and
its dependencies, readies clients, and releases the environment afterward. **Playwright runs the
checks and creates the HTML report**, with Blackbox's execution context and diagnostics.

In the prepared **product-cache sample** (see the alpha prerequisites below), run the Feature path:

```sh
# Run from e2e/product-cache/
pnpm exec blackbox feature file validate tests/product-cache.feature \
  --clients tests/clients.ts
pnpm exec blackbox feature suite validate tests/product-cache.feature \
  --clients tests/clients.ts --output tests/product-cache.generated.spec.ts
pnpm --dir .. exec playwright test --config product-cache/playwright.config.ts --project feature
pnpm --dir .. exec playwright show-report product-cache/playwright-report
```

For handwritten tests, select `--project native` instead. [Installation and runnable prerequisites](docs/guides/verify-a-specification.md#run-the-supplied-example) · [Feature generation](docs/features/generating-test-suites.md)

Open the report at the product scenario and follow its assertions into the stored-state and
retrieval observations. In the cache-bypass exercise, the response passes but the database-read
check fails. The agent repairs the code and reruns the **same expected behavior**.

**Effects snapshots preserve runtime expectations alongside the tests.** Review captured
interactions against the specification before accepting a baseline, then compare fresh executions
with it. For the cache rule, the relevant behavior is a retrieval that uses Redis without reading
PostgreSQL. The response and state assertions still check their own parts of the rule.

<p align="center">
  <img width="790" src="docs/assets/guides/product-cache-repair.svg" alt="Illustrative failure and repair: the request returns the correct product, but a PostgreSQL read fails the cache rule. The agent repairs the cache path and reruns the same assertions in a fresh attempt." />
</p>

When the cause is unclear, a **Capsule** lets the agent act on a running system, inspect observations,
and try a hypothesis. Its report preserves the experiment; the final Playwright test verifies the
behavior again in a fresh Sandbox. Known systems and checks can go straight to Playwright.

[Reports](docs/guides/reports.md) · [Follow the repair](docs/guides/repair-from-evidence.md) ·
[Investigate with Capsules](docs/guides/investigate-with-capsule.md)

## Keep the spec connected as code changes

**Review** checks that the tests express what you meant. **Generated-suite validation** checks that
TypeScript still matches its Feature. **Execution** checks the running implementation against the
accepted assertions and effects.

Use those expectations during local iteration and in CI. When intended behavior changes, review the
specification, tests, and relevant effects baseline together. A failed run should not silently
redefine success.

A passing test supports the assertions that ran under the observed conditions. Runtime observations,
including OpenTelemetry, help answer questions beyond the response. The requirement determines
which evidence each test needs.

[Spec-Driven Verification](docs/concepts/spec-driven-verification.md) ·
[Evidence](docs/concepts/behavioral-evidence.md) · [CI verification](docs/guides/ci-verification.md)

---

<a id="alpha-and-further-guides"></a>

**Alpha prerequisites:** the Feature compiler and typed Playwright clients from merged
[PR #181](https://github.com/suites-dev/blackbox/pull/181) are not included on this docs branch, and
the `e2e/product-cache/` sample is unpublished. The sample commands and examples require a checkout
containing both. See the [walkthrough prerequisites](docs/guides/verify-a-specification.md#run-the-supplied-example).

[All docs](docs/README.md) · [Contributing](CONTRIBUTING.md) · [License](LICENSE)
