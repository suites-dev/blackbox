# Express the product rule as a Feature

Your developer and coding agent have agreed that creation must store a product in
PostgreSQL and Redis, and that a valid-cache retrieval must avoid PostgreSQL.
This page expresses that same rule in Gherkin and runs it as native Playwright.

Complete [the sample preparation](../guides/verify-a-specification.md#run-the-supplied-example)
first. Continue from `e2e/product-cache/` with the supplied `api` client and runner.
You do not need to run the native authoring path first.

## Draft from the accepted specification

Give the agent [the source specification](../../e2e/product-cache/specs/create-product.md):

> Draft scenarios for this rule using Blackbox's supported HTTP sentences and our
> existing client. Keep creation and cached retrieval as separate Arrange, Act,
> Assert scenarios under the same Rule. Establish the database and cache state
> before retrieval. Identify any clause the proposed assertions cannot establish.

The agent authors a candidate for review. The current CLI validates and compiles
Features; automatic CLI drafting is not available.

## Review the Feature, Rule, and Scenarios

The complete supplied
[`product-cache.feature`](../../e2e/product-cache/tests/product-cache.feature)
contains the two scenarios:

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

The Feature names the capability. The Rule states the accepted expectation. Each
Scenario gives one concrete example, with setup before its action and assertions.
Blackbox preserves that nesting and step order in the generated suite and report.

Creation checks the response and both stored values. Cached retrieval establishes
those values first, opens a bounded observation window, performs one GET, and
checks its response and database/cache observations. The calibration step first
proves that a known cache miss registers a database read.

The `/fixture/` routes belong to this sample. Their authenticated HTTP responses
expose actual state and operation counters. They let the current HTTP-only
compiler express the claims without pretending it has native Redis or database
sentences. Connection details and the fixture token live in
[`clients.ts`](../../e2e/product-cache/tests/clients.ts).

## Validate and inspect the generated suite

Validate the reviewed Feature and its client export names:

```sh
pnpm exec blackbox feature file validate tests/product-cache.feature --clients tests/clients.ts
```

The sample already includes the generated suite. Confirm it matches the Feature:

```sh
pnpm exec blackbox feature suite validate tests/product-cache.feature --clients tests/clients.ts --output tests/product-cache.generated.spec.ts
```

To inspect generation yourself, emit a new candidate beside it:

```sh
pnpm exec blackbox feature suite emit tests/product-cache.feature --clients tests/clients.ts --output tests/product-cache.preview.ts
```

The destination must not already exist. Compare that candidate with
[`product-cache.generated.spec.ts`](../../e2e/product-cache/tests/product-cache.generated.spec.ts).
It preserves the Feature and Rule groups, both Scenario tests, and their ordered
steps. The `.preview.ts` suffix keeps the candidate out of test discovery.

## Execute and return to the evidence

```sh
pnpm exec tsc --project tsconfig.json
pnpm --dir .. exec playwright test --config product-cache/playwright.config.ts --project feature --list
pnpm --dir .. exec playwright test --config product-cache/playwright.config.ts --project feature
pnpm --dir .. exec playwright show-report product-cache/playwright-report
```

Expect **two scenarios**, each in its own isolated Sandbox. Open their steps and
match the executed assertions to the accepted rule.

Continue at [Read the evidence](../guides/verify-a-specification.md#read-the-evidence).
Then use the same Feature and generated assertions for the
[cache-bypass failure and repair](../guides/repair-from-evidence.md). The authoring
choice does not change what the system must do.

If validation rejects a sentence, use the [sentence reference](reference.md#sentence-reference).
If execution fails, investigate the observed discrepancy before changing an
expectation. For later reviewed edits, follow [Feature maintenance](generating-test-suites.md).
