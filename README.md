<p align="center">
  <img width="80" src="https://raw.githubusercontent.com/suites-dev/suites/master/logo.png" alt="Suites logo" />
</p>

<h1 align="center">Suites / Blackbox</h1>

**A system testing framework for executable specifications and runtime verification, built for developers and coding
agents.**

Blackbox turns accepted specifications into repeatable verification against real applications and subsystems. Coding
agents can execute the specified behavior, inspect what happened, investigate failures, repair the implementation, and
rerun against the same accepted expectations.

Expected behavior can be expressed directly in native Playwright tests or through optional executable Feature files
that generate a native suite. Each test attempt runs in a fresh isolated Sandbox, using response, state, and runtime
evidence to evaluate the specified claims.

## Blackbox and Spec-Driven Verification

Spec-Driven Verification checks a running system against an accepted specification. That specification can come from
product requirements, acceptance criteria, an API contract (like Swagger and OpenAPI), a Markdown document, or any
other source of agreed behavior.

Developers and coding agents turn those requirements into executable expectations for review. They can write native
Playwright tests directly or generate suites from Feature files. Blackbox runs the selected application or
subsystem and gathers evidence for the specified claims.

<p align="center">
  <img width="800" src="docs/assets/readme/specification-to-evidence.svg" alt="create-product.md guides a reviewed product-cache.feature and generated product-cache.generated.spec.ts. Playwright runs product-service with PostgreSQL and Redis; the execution report presents assertions and attempt diagnostics." />
</p>

The example follows a simple requirement: creating a product persists it in PostgreSQL and populates Redis. Retrieving
it while cached must use Redis without reading PostgreSQL. A correct HTTP response alone cannot establish that rule;
the test also needs state and runtime evidence. The figure shows the optional Feature route from specification to
execution. Native Playwright can express the same expectations directly.

Specifications in any format can become stale as implementation evolves. Blackbox keeps their accepted expectations
in the verification loop: review checks that executable expectations preserve the intended behavior, and repeated
execution makes departures from that behavior visible.

[Start the tutorial](docs/guides/verify-a-specification.md) · [Documentation](docs/README.md) · [Feature workflow](docs/features/README.md)

## Onboarding | Your agent handles the setup

Ask your coding agent to set up Blackbox for your repository. Blackbox's skill
system guides repository discovery, topology design, and configuration; the CLI
returns structured information the agent can use to check its work.

With `@suites/blackbox-cli` and `@suites/blackbox` installed in your project, inspect
the available skills and install the entry skill for your agent, for example Codex:

```sh
pnpm exec blackbox skills list
pnpm exec blackbox skills install blackbox --codex
```

Use `--claude` or `--cursor` for those hosts. Follow the
[skill installation guide](packages/blackbox/skills/blackbox/references/skill-installation.md)
for the discovery and catalog skills the entry workflow uses. Playwright and
Feature support are selected separately; the [application setup guide](docs/playwright/connect-your-application.md)
explains the required packages. These docs describe the candidate alpha implementation.

### Agent Onboarding

During onboarding, the agent inspects the repository, discovers services and dependencies, and derives the system
topology. It identifies useful application and subsystem boundaries, then creates or updates the Blackbox configuration
and supporting files.

<p align="center">
  <img width="800" src="docs/assets/readme/onboarding-discovery.svg" alt="Agent onboarding discovers services and dependencies, derives system boundaries, then creates and validates Blackbox configuration." />
  <br />
  <sub>The agent derives runnable boundaries from the repository’s services and dependencies.</sub>
</p>

The result describes what to run, how to start it, and how to act on and observe it. The agent reuses existing project
files where appropriate. For a Node application with an HTTP service, the setup could look like this:

<p align="center">
  <img width="800" src="docs/assets/readme/onboarding-files.svg" alt="Example project tree with blackbox.config.yaml and .blackbox catalog, driver, and instrumentation files." />
  <br />
  <sub>Configuration references the files that start, drive, and observe the system.</sub>
</p>

`blackbox.config.yaml` is the configuration authority and references the supporting files. Capsules and Playwright use
that configuration to run the selected system and collect evidence.

[Agent onboarding skill](packages/blackbox/skills/blackbox/SKILL.md) ·
[Agent skills](packages/skills/README.md)

## Blackbox and Behavior-driven development

Blackbox adopts Gherkin (Cucumber) to express behavior as `Features`, `Rules`, and
`Scenarios`. `Given`, `When`, and `Then` correspond to `Arrange`, `Act`, and `Assert`: establish
a known precondition, exercise the system, and check the specified outcome.
Feature files are optional; native Playwright tests can express the same approach
directly with your project's SDKs.

The specification stays focused on observable system behavior. Client definitions
and test setup hold the connection details. Generated suites preserve the
Feature → Rule → Scenario nesting, Background hooks, and authored step order, so
reviewers can follow an expectation into the test that executes it.

<p align="center">
  <img width="800" src="docs/assets/readme/specification-triangle.svg" alt="The accepted product specification guides a reviewed optional Feature. Generation preserves its rule, scenarios, and Arrange–Act–Assert structure in Playwright. Execution checks PostgreSQL persistence, Redis state, and cache-hit behavior." />
</p>

Keeping a specification current takes three checks: review the scenarios against
the accepted intent, check that generated code still matches the Feature, and run
the assertions against the system. Each catches a different kind of drift.
Blackbox does not automatically prove that a prose document is fully covered.

<details>
<summary>See the product specification, Feature, and generated Playwright suite</summary>

[`specs/create-product.md`](e2e/product-cache/specs/create-product.md) defines the behavior:

```markdown
# Product creation and retrieval

## Rule: Persist products and serve valid cache entries

Creating a product persists it in PostgreSQL and populates Redis.
Retrieving it while its cached entry is valid returns the cached product
without reading PostgreSQL.
```

The [complete Feature](e2e/product-cache/tests/product-cache.feature) expresses
creation and cached retrieval as separate scenarios under that rule. Fixture
endpoints belong to this small example application: they expose real stored state
and isolated database/cache operation counters through the compiler's supported
HTTP sentences.

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

    Scenario: Retrieve a product from its valid cache entry
      Given client "api" sends POST "/fixture/observations/calibrate" with JSON:
        """json
        {}
        """
      And the response status is 200
      And the response JSON contains:
        """json
        {
          "applicationPostgresSelects": 1,
          "applicationPostgresStatements": 1,
          "applicationPostgresPlans": 1,
          "redisGets": 1,
          "retrievals": 1
        }
        """
      And client "api" has sent POST "/products" with JSON and received 201:
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
      And client "api" has sent POST "/fixture/observations/start" with JSON and received 200:
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

The [generated suite](e2e/product-cache/tests/product-cache.generated.spec.ts)
preserves the same hierarchy and steps:

<!-- prettier-ignore -->
```ts
import { expect, test } from '@suites/blackbox-playwright';
import { api as client_api } from "./clients.js";

test.system({ kind: 'system', id: "product-system" }, (system) => {
  system.sandbox("default", { clients: { "api": client_api } }, (suite) => {
    suite.describe("Feature: Product creation and retrieval", () => {
      suite.describe("Rule: Persist products and serve valid cache entries", () => {
        suite.test("Scenario: Create a new product", async ({ clients, step }) => {
          await step("Given client \"api\" GET \"/fixture/products/product-1\" returns 200 with JSON exactly:", async () => {
            const response = await clients.api.get("/fixture/products/product-1");
            expect(response.status()).toBe(200);
            expect(await response.json()).toEqual({"postgres":null,"redis":null});
          });
          const response0 = await step("When client \"api\" sends POST \"/products\" with JSON:", () => clients.api.post("/products", { data: {"id":"product-1","name":"Field notebook","priceCents":1299} }));
          await step("Then the response status is 201", async () => {
            expect(response0.status()).toBe(201);
          });
          await step("And the response JSON contains:", async () => {
            expect(await response0.json()).toMatchObject({"id":"product-1","name":"Field notebook","priceCents":1299});
          });
          await step("And client \"api\" GET \"/fixture/products/product-1\" returns 200 with JSON exactly:", async () => {
            const response = await clients.api.get("/fixture/products/product-1");
            expect(response.status()).toBe(200);
            expect(await response.json()).toEqual({"postgres":{"id":"product-1","name":"Field notebook","priceCents":1299},"redis":{"id":"product-1","name":"Field notebook","priceCents":1299}});
          });
        });

        suite.test("Scenario: Retrieve a product from its valid cache entry", async ({ clients, step }) => {
          const response1 = await step("Given client \"api\" sends POST \"/fixture/observations/calibrate\" with JSON:", () => clients.api.post("/fixture/observations/calibrate", { data: {} }));
          await step("And the response status is 200", async () => {
            expect(response1.status()).toBe(200);
          });
          await step("And the response JSON contains:", async () => {
            expect(await response1.json()).toMatchObject({"applicationPostgresSelects":1,"applicationPostgresStatements":1,"applicationPostgresPlans":1,"redisGets":1,"retrievals":1});
          });
          await step("And client \"api\" has sent POST \"/products\" with JSON and received 201:", async () => {
            const response = await clients.api.post("/products", { data: {"id":"product-1","name":"Field notebook","priceCents":1299} });
            expect(response.status()).toBe(201);
          });
          await step("And client \"api\" GET \"/fixture/products/product-1\" returns 200 with JSON exactly:", async () => {
            const response = await clients.api.get("/fixture/products/product-1");
            expect(response.status()).toBe(200);
            expect(await response.json()).toEqual({"postgres":{"id":"product-1","name":"Field notebook","priceCents":1299},"redis":{"id":"product-1","name":"Field notebook","priceCents":1299}});
          });
          await step("And client \"api\" has sent POST \"/fixture/observations/start\" with JSON and received 200:", async () => {
            const response = await clients.api.post("/fixture/observations/start", { data: {"productId":"product-1"} });
            expect(response.status()).toBe(200);
          });
          const response2 = await step("When client \"api\" sends GET \"/products/product-1\"", () => clients.api.get("/products/product-1"));
          await step("Then the response status is 200", async () => {
            expect(response2.status()).toBe(200);
          });
          await step("And the response JSON contains:", async () => {
            expect(await response2.json()).toMatchObject({"id":"product-1","name":"Field notebook","priceCents":1299});
          });
          await step("And client \"api\" GET \"/fixture/observations/result\" returns 200 with JSON exactly:", async () => {
            const response = await clients.api.get("/fixture/observations/result");
            expect(response.status()).toBe(200);
            expect(await response.json()).toEqual({"productId":"product-1","applicationPostgresSelects":0,"applicationPostgresStatements":0,"applicationPostgresPlans":0,"redisGets":1,"retrievals":1});
          });
        });
      });
    });
  });
});
```

The cache-miss calibration checks that the observer detects a database read.
Creation and state inspection then establish the cached product before the
retrieval window. The final assertions check that retrieval's response, Redis
GET count, and absence of application PostgreSQL statements. See the
[walkthrough](docs/guides/verify-a-specification.md) for setup and evidence interpretation.

</details>

From the prepared example's `e2e/product-cache/` directory, validate the reviewed
Feature, check its generated suite, and execute it with Playwright:

```sh
pnpm exec blackbox feature file validate tests/product-cache.feature --clients tests/clients.ts
pnpm exec blackbox feature suite validate tests/product-cache.feature --clients tests/clients.ts --output tests/product-cache.generated.spec.ts
pnpm --dir .. exec playwright test --config product-cache/playwright.config.ts --project feature
```

The current compiler supports a [closed HTTP vocabulary](docs/features/reference.md#sentence-reference).
A human or coding agent drafts and reviews scenarios; automatic CLI drafting and
completed-run Feature verification are not yet available.

[Author a Feature](docs/features/drafting-feature-files.md) ·
[Generate suites and check drift](docs/features/generating-test-suites.md)

## Write system tests with native Playwright

Use native tests when you want to author TypeScript directly or combine HTTP,
database, cache, and messaging operations. Register your project's SDK clients
with `defineClient`; Blackbox resolves their Sandbox endpoints and handles
readiness and disposal. Their methods and types remain available in the test.

Handwritten and generated suites use the same per-attempt Sandbox, fixtures,
`step` function, assertions, and reports. A project can use either path or both.

| What you want to establish                                       | Guide                                                 |
| ---------------------------------------------------------------- | ----------------------------------------------------- |
| The API returns the specified response                           | [HTTP requests](docs/guides/testing-http-apis.md)     |
| The application commits the expected row                         | [PostgreSQL state](docs/guides/testing-postgres.md)   |
| A cached retrieval uses Redis without a database read            | [Redis behavior](docs/guides/testing-redis.md)        |
| An eventual outcome reaches its accepted state within a deadline | [Bounded polling](docs/guides/testing-async-flows.md) |

[Verify the product rule](docs/guides/verify-a-specification.md) ·
[Clients and fixtures](docs/playwright/clients-and-fixtures.md)

## Developer-agent verification loop

The developer approves the specification, expected outcomes, and verification policy. The coding agent uses that
guidance to implement the behavior, prepare system tests, and investigate failures.

<p align="center">
  <img width="800" src="docs/assets/readme/human-agent-verification-loop.svg" alt="The developer approves intent and policy, the coding agent prepares and repairs system tests, and Blackbox returns runtime evidence and findings. Proposed changes to intent or policy return to the developer for review." />
</p>

Test results and retained runtime evidence give the agent a concrete failure to investigate. The agent repairs the
implementation and reruns verification against the same accepted expectations. In the
[product repair walkthrough](docs/guides/repair-from-evidence.md), the response remains correct while runtime evidence
reveals an unnecessary PostgreSQL read. Proposed changes to the specification
or verification policy return to the developer for review.

## Inspect the result and its evidence

Playwright remains the test runner. Blackbox adds execution context and evidence to its terminal and HTML reports.
Both authoring workflows use that reporting path. The report keeps the authored
steps with the result; Blackbox attaches lifecycle diagnostics and an attempt
record. Retention can preserve the Sandbox's artifacts and telemetry for later
inspection.

Response and state assertions work today. Feature coverage, completed-run claim
qualification, and the richer [report illustration](docs/assets/readme/illustrative-report.svg)
remain under development. The alpha effects matcher fails as inconclusive unless
a runtime supplies an evaluator; registering an SDK does not automatically add
trace propagation or normalized effect assertions.

Different claims require different evidence. Observing a database operation does not establish that a transaction
committed. Observing a message being published does not establish that a consumer completed its work. An operation that
was not observed is not automatically evidence that it never happened.

Blackbox keeps those limits explicit so a passing verification does not claim more than the execution established.

From `e2e/product-cache/`, open the native HTML report to inspect test results,
steps, and attached Blackbox diagnostics:

```sh
pnpm --dir .. exec playwright show-report product-cache/playwright-report
```

[Playwright reporting](docs/guides/repair-from-evidence.md#keep-attempt-evidence) ·
[Telemetry and effects fixtures](docs/playwright/clients-and-fixtures.md)

## Investigate with Capsules

When a test fails or its evidence leaves a question unresolved, the agent can use a Capsule to investigate. Capsules also support experiments
with candidate expectations before they become accepted behavior.

| Mode                   | Purpose                                                                      |
| ---------------------- | ---------------------------------------------------------------------------- |
| Playwright system test | Repeat accepted expectations against a fresh isolated Sandbox.               |
| Capsule                | Act on a running system, inspect evidence, test a hypothesis, and try again. |

A Capsule is a bounded interactive experiment. The agent can inspect what happened, change the implementation, and
repeat the experiment. When the investigation suggests a new expectation, it goes through review before becoming part
of the accepted specification. The example below carries that expectation into an accepted Feature and its Playwright
suite:

<p align="center">
  <img width="800" src="docs/assets/readme/capsule-to-feature.svg" alt="Capsule investigation moves from act, inspect, investigate, and retry to a candidate expectation, review, accepted Feature, and Playwright verification." />
  <br />
  <sub>Candidate expectations require review before joining the accepted specification.</sub>
</p>

**Observed behavior is not automatically accepted behavior.** A Capsule can validate or challenge a candidate
expectation; the accepted specification remains the source of what the implementation must satisfy.

Stopping the environment does not discard the experiment. Its activities, observations, and evidence remain available
for inspection and reporting.

[Capsules](packages/capsule/README.md) ·
[Playwright testing](docs/playwright/README.md) ·
[Authoring Features](docs/features/drafting-feature-files.md)

---

## Run the system your claim requires

Blackbox can run a full application or a smaller subsystem. Use the smallest real system boundary that can answer the
claim being checked, including every participant needed to establish the behavior.

A focused boundary lowers startup cost, memory use, and unrelated runtime noise. It also reduces the number of competing
explanations when an execution fails. A cross-service workflow still needs the participants required to establish that
workflow.

The agent configures these boundaries during discovery. Configuration selects the system, drivers provide controlled
ways to act on it and inspect state, and instrumentation provides supported runtime observations:

<p align="center">
  <img width="800" src="docs/assets/readme/system-boundary.svg" alt="blackbox.config.yaml selects system boundary, drivers, and instrumentation for Capsule or Playwright execution." />
  <br />
  <sub>Capsules and Playwright share the configured boundary, drivers, and instrumentation.</sub>
</p>

Use unit tests for the behavior of a function or class. Use Blackbox when the claim concerns a running application or
subsystem, including when an internal implementation change could affect that behavior.

[Catalog and system selection](packages/catalog/README.md) ·
[Configuration schema](packages/catalog/schema/blackbox-config-v1.json) ·
[Drivers](packages/driver/README.md) ·
[Node instrumentation](packages/instrumentation-runtime-node/README.md)

---

## Keep verification consistent locally and in CI

Local iteration and CI use the same accepted expectations. An agent can focus on selected scenarios and Capsule
experiments during development, while CI runs the suite selected by the repository's verification policy.

Every physical Playwright attempt gets a fresh Sandbox. Isolation enables parallel execution; CPU, memory, and container
resources determine how much concurrency is practical.

Run native suites with the same Playwright configuration locally and in CI. For generated suites, also check that
the committed TypeScript still matches the reviewed Feature and compiler inputs. From the
prepared product example:

```sh
pnpm exec blackbox feature suite validate tests/product-cache.feature --clients tests/clients.ts --output tests/product-cache.generated.spec.ts
pnpm --dir .. exec playwright test --config product-cache/playwright.config.ts --project feature
```

The drift check compares generated bytes; Playwright executes the assertions. Keep normal TypeScript checks in the
project's validation workflow. Review changes to accepted expectations before replacing a generated suite.

[Playwright configuration](docs/playwright/README.md) ·
[Check generated-suite drift](docs/features/generating-test-suites.md#check-for-drift)

---

## Alpha and next steps

Blackbox is under active development. Native Playwright testing and Feature validation, generation, and drift checks
are implemented in this branch. Automatic Feature drafting, completed-run verification, and Feature coverage remain
unavailable while their contracts are developed.

Start with [coding-agent onboarding](#agent-onboarding), or follow either authoring guide:

[Playwright guide](docs/playwright/README.md) ·
[Feature guide](docs/features/README.md) ·
[CLI reference](packages/cli/README.md)
