<p align="center">
  <img width="80" src="https://raw.githubusercontent.com/suites-dev/suites/master/logo.png" alt="Suites logo" />
</p>

<h1 align="center">Suites / Blackbox</h1>

**Spec-Driven Verification for agentic software engineering.**

Blackbox is a verification framework for **people building software with coding agents**. It gives agents the means to check whether a running implementation behaves according to an **accepted specification**—using isolated system tests, executable expectations, and evidence of what actually happened.

**Specifications define intent. Executions produce evidence. Verification connects them.**

**CLI + agent skills** guide setup and investigation. **Native Playwright or optional Gherkin** carries reviewed expectations. **Sandboxes and evidence** make each execution inspectable.

[Start with your agent](#start-with-your-agent) · [Verify a specification](docs/guides/verify-a-specification.md) · [Documentation](docs/README.md)

## Verify behavior, not implementation

A coding agent can rewrite internals without changing what the system must do. Conversely, an endpoint can return the right response while violating the accepted behavior.

Consider this specification:

> Creating a product persists it in PostgreSQL and populates Redis. Retrieving it while cached must use Redis **without reading PostgreSQL**.

A correct HTTP response alone cannot establish this rule:

| Behavioral claim                         | Evidence it needs                                                                       |
| ---------------------------------------- | --------------------------------------------------------------------------------------- |
| Creation returns the expected product    | Response status and body                                                                |
| Creation persists and caches the product | Independent PostgreSQL and Redis state reads                                            |
| Cached retrieval avoids PostgreSQL       | Bounded, **calibrated** observations of the application's database and cache operations |

The specification determines **what must hold**. Blackbox helps your agent construct and run checks that can evaluate those claims, not merely find a green response. [How evidence works](docs/concepts/behavioral-evidence.md).

## Start with your agent

Blackbox supplies a CLI and skills for repository discovery, system configuration, test authoring, and investigation. Give your coding agent the accepted requirement and this task:

```text
Set up Suites Blackbox to verify the accepted specification in this repository.

Discover the services and dependencies. Select the smallest system boundary
that can establish its claims, and configure an isolated Sandbox.
Identify what response, state, and runtime evidence each claim requires.
Prepare executable scenarios for my review, run a focused verification,
and show me the HTML report and any evidence limitations.

Do not change the accepted specification to match the implementation.
```

The planned one-command onboarding entry point is `npx @suites/blackbox-cli onboarding start`. **It is not yet available in this candidate alpha.** Use the documented [source setup and agent skills](docs/playwright/connect-your-application.md) in the meantime. You can also configure Blackbox and write tests yourself.

[Connect your application](docs/playwright/connect-your-application.md) · [Follow the worked example](docs/guides/verify-a-specification.md)

## From specification to executable verification

The source may be Markdown, acceptance criteria, an API contract, or an SDD artifact such as [Spec Kit](docs/integrations/spec-kit.md). It remains authoritative; Blackbox does not take over requirements ownership.

<p align="center">
  <img width="800" src="docs/assets/guides/product-cache-journey.svg" alt="An accepted product requirement leads to reviewed native Playwright or optional Gherkin expectations. Both execute against a selected real system in an isolated Sandbox and produce evidence." />
</p>

The agent identifies claims and their required observations, then proposes executable expectations. **You review the expectation before judging the implementation against it.**

### Native Playwright

Write system checks in TypeScript using your project's SDKs. This excerpt verifies creation; the [full walkthrough](docs/guides/verify-a-specification.md) also verifies retrieval without a PostgreSQL read.

```ts
import { expect, test } from '@suites/blackbox-playwright';
import { api } from './clients.js';

test.system('product-system', (system) => {
  system.sandbox('default', { clients: { api } }, (suite) => {
    // Every test attempt receives a fresh isolated Sandbox.
    suite.test('creates and stores a product', async ({ clients }) => {
      const product = { id: 'product-1', name: 'Field notebook', priceCents: 1299 };
      const response = await clients.api.post('/products', { data: product });
      expect(response.status()).toBe(201);
      expect(await response.json()).toMatchObject(product);
      const state = await clients.api.get('/fixture/products/product-1');
      expect(await state.json()).toEqual({ postgres: product, redis: product });
    });
  });
});
```

`/fixture/products/...` is a **sample-owned inspection endpoint**, not a built-in Blackbox API.

### Optional Gherkin Feature

A reviewed `Feature → Rule → Scenario` gives developers and agents a shared way to express accepted behavior. Blackbox compiles supported Gherkin sentences into native Playwright tests:

```gherkin
@system:product-system @sandbox:default
Feature: Product creation and retrieval
  Rule: Persist products and serve valid cache entries
    Scenario: Create a product
      When client "api" sends POST "/products" with JSON:
        """json
        { "id": "product-1", "name": "Field notebook", "priceCents": 1299 }
        """
      Then the response status is 201
```

This deliberately short scenario checks **only response status**. It does not prove persistence or cache behavior; the [full Feature](docs/features/drafting-feature-files.md) adds those claims. Feature files are optional, and their vocabulary is intentionally narrower than arbitrary TypeScript.

[Native Playwright](docs/playwright/README.md) · [Feature authoring](docs/features/README.md) · [Verification model](docs/concepts/spec-driven-verification.md)

## Collect evidence that can answer the claim

Playwright runs the tests. Blackbox builds and starts the configured application or subsystem, connects clients, retains available observations and diagnostics, and tears the environment down. **Each physical attempt—including retries—gets a fresh Sandbox.**

Evidence can come from an **entrypoint outcome** (HTTP response, queue processing outcome, CLI exit), **state** (PostgreSQL row, Redis value), or **runtime effects** (supported observations of HTTP, database, messaging, and other operations). These are not three mandatory boxes; each claim determines what is needed.

An observed `INSERT` does not prove commit. A queue acknowledgment does not prove downstream business completion. **Missing telemetry does not prove an operation never occurred.** A credible negative assertion often needs a bounded observation and a positive control.

OpenTelemetry helps capture runtime effects. It is an **evidence source**, not Blackbox's definition or a universal correctness oracle. The current alpha does not support every effect or entrypoint described conceptually in the guides.

[Behavioral evidence](docs/concepts/behavioral-evidence.md) · [PostgreSQL](docs/guides/testing-postgres.md) · [Redis](docs/guides/testing-redis.md) · [Asynchronous completion](docs/guides/testing-async-flows.md)

## Repair the implementation, not the expectation

In the [cache-bypass repair exercise](docs/guides/repair-from-evidence.md), the API still returns the right product but makes a forbidden PostgreSQL read. The test detects that violation, and the coding agent repairs the cache path and reruns **unchanged expectations**.

<p align="center">
  <img width="800" src="docs/assets/readme/human-agent-verification-loop.svg" alt="The developer approves intent and policy. An agent implements, investigates execution evidence, repairs the code, and reruns unchanged expectations." />
</p>

A [Capsule](packages/capsule/README.md) enables interactive investigation when the reason for a failure is unclear. Its experiments do not authorize changing the accepted specification.

**Passing assertions establish what this execution checked—not the correctness or completeness of every requirement.**

## Local and CI verification

Run focused checks locally and the broader accepted suite in CI. With optional Features, a generated-suite drift check establishes that TypeScript still matches the reviewed Feature; executing it checks the running system. Neither automatically proves every statement in the original spec is covered.

[Suite drift](docs/features/generating-test-suites.md) · [Evidence-led repair](docs/guides/repair-from-evidence.md)

## Documentation

[Specification walkthrough](docs/guides/verify-a-specification.md) · [Connect your application](docs/playwright/connect-your-application.md) · [Concepts](docs/concepts/README.md) · [Client and fixture API](docs/playwright/clients-and-fixtures.md) · [Feature reference](docs/features/reference.md) · [Spec Kit integration](docs/integrations/spec-kit.md)

### Alpha and further guides

**Candidate alpha:** the typed Playwright client API and Feature compiler depend on [PR #181](https://github.com/suites-dev/blackbox/pull/181), and the `e2e/product-cache/` sample has not landed on this documentation branch. The guides are technical references until those prerequisites are present. [Availability](docs/guides/verify-a-specification.md#run-the-supplied-example).

[Contributing](CONTRIBUTING.md) · [License](LICENSE)
