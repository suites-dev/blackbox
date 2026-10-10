<p align="center">
  <img width="80" src="https://raw.githubusercontent.com/suites-dev/suites/master/logo.png" alt="Suites logo" />
</p>

<h1 align="center">Suites / Blackbox</h1>

**Spec-Driven Verification for agentic software engineering.**

Coding agents can implement—and reimplement—features faster than teams can inspect every change. But a plausible implementation isn't the same as a working system. **How do you know it still does what you intended?**

Blackbox helps your coding agent turn **accepted behavior** into repeatable checks against the **running application**. It prepares isolated systems, executes native Playwright tests or reviewed Gherkin Features, and retains the results and observations needed to investigate failures.

**The implementation can change. The expected behavior stays in view.**

[Give your agent a spec](#give-your-agent-a-spec) · [Follow a real example](docs/guides/verify-a-specification.md) · [Why verification matters now](docs/concepts/why-verification-now.md)

## A correct response can still be a broken feature

Consider one accepted rule:

> Creating a product stores it in PostgreSQL and Redis. Retrieving that product while cached **must not read PostgreSQL**.

An agent can write code that returns the correct product while quietly bypassing the cache. An HTTP response check passes. The *behavior* is wrong.

<p align="center">
  <img width="790" src="docs/assets/guides/product-cache-evidence.svg" alt="Creation stores a product in PostgreSQL and Redis. A cache-bypass implementation still returns the right product but also reads PostgreSQL, violating the accepted rule." />
</p>

To check this rule, we need the response, the saved values, and a reliable observation of database activity during retrieval. **The specification tells us what to check; the running system supplies the results.**

[See how the evidence is checked](docs/concepts/behavioral-evidence.md)

## Give your agent a spec

Blackbox's **CLI and agent skills** help discover services, configure a runnable system, connect clients, and investigate failures. Copy this task into your coding agent:

```text
Use Suites Blackbox to verify the accepted specification in this repo.
Discover the smallest real system needed for the behavior and configure it.
Prepare executable checks for my review, then run one focused scenario.
Show me the result, relevant evidence, and anything you couldn't check.
Keep the accepted expectations unchanged when repairing implementation.
```

With compatible source packages installed, the current skills can be discovered and installed:

```sh
pnpm exec blackbox skills list
pnpm exec blackbox skills install blackbox --codex
pnpm exec blackbox skills install discovery --codex
pnpm exec blackbox skills install catalog --codex
```

Use `--claude` or `--cursor` for those hosts. The planned shortcut, `npx @suites/blackbox-cli onboarding start`, **isn't shipped yet**. [Connect your own application](docs/playwright/connect-your-application.md).

<p align="center">
  <img width="790" src="docs/assets/readme/onboarding-discovery.svg" alt="The agent discovers services and dependencies, chooses a useful system boundary, and prepares Blackbox configuration." />
</p>

## Make the spec executable

Your source can be Markdown, acceptance criteria, an API contract, or an SDD workflow such as [Spec Kit](docs/integrations/spec-kit.md). **You approve the intended behavior**; the agent proposes the checks.

<p align="center">
  <img width="790" src="docs/assets/guides/authoring-paths.svg" alt="An accepted specification leads to native Playwright or an optional Gherkin Feature. Both run through the same Sandbox and reporting path." />
</p>

**Option A · Reviewed Feature.** Gherkin gives humans and agents a readable `Feature → Rule → Scenario` structure. Blackbox's **supported step vocabulary** turns that structure into a small, validated language that compiles to native Playwright.

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

This excerpt checks **only the response status**. The [full Feature](docs/features/drafting-feature-files.md) also checks storage and cache behavior. [Why a constrained Feature language?](docs/features/README.md#why-a-feature-helps-coding-agents)

**Option B · Native Playwright.** Write TypeScript with your application's SDKs and ordinary assertions. No Feature file is required.

```ts
import { expect, test } from '@suites/blackbox-playwright';
import { api } from './clients.js';

test.system('product-system', (system) => {
  system.sandbox('default', { clients: { api } }, (suite) => {
    // Every physical test attempt gets its own isolated Sandbox.
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

The `/fixture/` endpoint belongs to the **example application**, not Blackbox. The [complete native suite](docs/playwright/README.md) has another scenario for retrieving a cached product without a database read.

## Run it, inspect it, repair it

Playwright executes each check. Blackbox starts the selected application and dependencies in a fresh **Sandbox**, connects its clients, and records the attempt's results and diagnostics. This makes the check repeatable even as the agent rewrites the implementation.

In the **candidate product-cache sample**, the optional Feature workflow is:

```sh
# From e2e/product-cache/, once PR #181 and the sample are available:
pnpm exec blackbox feature file validate tests/product-cache.feature --clients tests/clients.ts
pnpm exec blackbox feature suite validate tests/product-cache.feature \
  --clients tests/clients.ts --output tests/product-cache.generated.spec.ts
pnpm --dir .. exec playwright test --config product-cache/playwright.config.ts --project feature
pnpm --dir .. exec playwright show-report product-cache/playwright-report
```

For directly authored tests, run the `native` Playwright project instead. These commands are **not runnable from this docs-only branch yet**; see [prerequisites](docs/guides/verify-a-specification.md#run-the-supplied-example).

When a cache-bypass bug appears, the response still passes—but the database-read check fails. The agent can investigate, repair the code, and rerun **the same accepted expectation**.

<p align="center">
  <img width="790" src="docs/assets/readme/human-agent-verification-loop.svg" alt="The developer approves expected behavior. The coding agent implements, checks runtime results, repairs, and reruns without silently changing the specification." />
</p>

Use a [Capsule](docs/guides/investigate-with-capsule.md) to experiment when a failure needs investigation; use Playwright to keep accepted behavior under repeatable test and CI execution. [Walk through a deliberate defect and repair](docs/guides/repair-from-evidence.md).

## Check behavior, not code shape

An implementation can be replaced completely while its intended behavior stays the same. This is why the spec-to-test relationship matters:

| Question | What checks it? |
| --- | --- |
| Did we capture the behavior we meant? | **Review** executable expectations against the spec |
| Does generated TypeScript match the reviewed Feature? | **Validate suite drift** |
| Does the running implementation satisfy the checks? | **Run the system tests** |

A passing system test supports **the assertions it executed under the conditions it observed**—not mathematical proof of every possible execution or proof that the original spec is complete. Outputs, state reads, and runtime effects (including OpenTelemetry observations) are evidence sources chosen for the behavior being checked.

[Why verification matters in agentic development](docs/concepts/why-verification-now.md) · [Evidence and limitations](docs/concepts/behavioral-evidence.md) · [Generated-suite drift](docs/features/generating-test-suites.md)

---

## Alpha and further guides

**Candidate alpha:** the Feature compiler and typed Playwright clients depend on [PR #181](https://github.com/suites-dev/blackbox/pull/181). The referenced `e2e/product-cache/` sample isn't yet in this documentation branch. Treat its walkthrough as a technical preview, not a successful run recorded here.

[All documentation](docs/README.md) · [Contributing](CONTRIBUTING.md) · [License](LICENSE)
