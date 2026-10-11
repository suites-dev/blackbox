# Case study: express the product rule as a Feature

Translate the [product-cache requirement](../guides/verify-a-specification.md)
into two reviewed scenarios: creation and cache-only retrieval.

**Candidate example:** the compiler and typed clients are outside this branch,
and the product application and fixture endpoints are not supplied. The Feature
below describes the intended fixture protocol. It cannot execute until that
protocol, its observers, and a compatible test project exist.

## Draft from the accepted specification

Ask the agent to preserve each claim, its starting state, and its completion
condition. Use supported sentences; route a claim to native TypeScript if the
compiler cannot express it. Review any clause left unobservable.

The candidate compiler supports HTTP steps. The proposed `/fixture/` endpoints
allow state and counter inspection through that vocabulary; they are application
code, not built-in Blackbox operations. See the
[HTTP client definition](../guides/testing-http-apis.md#connect-the-api-client).

## Review the Feature, Rule, and Scenarios

The complete candidate `product-cache.feature` below contains both scenarios. This is an illustrative contract for an application you must supply; see [availability](../alpha-status.md).

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

The Feature names the capability. The Rule states the accepted expectation. Each Scenario gives one
concrete example, with setup before its action and assertions. Blackbox preserves that nesting and
step order in the generated suite and report.

Creation checks the response and both stored values. Cached retrieval establishes those values
first, opens a bounded observation window, performs one GET, and checks its response and
database/cache observations. The proposed calibration step must demonstrate that a known cache miss registers a
database read before the absence check can be trusted.

The `/fixture/` routes belong to this sample. An implementation must make their authenticated HTTP responses expose independently read state
and scoped operation counters. They let the current HTTP-only compiler express the claims without
pretending it has native Redis or database sentences. Connection details and the fixture token live
in [sample API client](../guides/testing-http-apis.md#connect-the-api-client).

## Validate and inspect the generated suite

After implementing the application and configuring the candidate compiler, save
this Feature as `tests/product-cache.feature` and export the real `api` client
from `tests/clients.ts`. From that project's root:

```sh
npx blackbox feature file validate tests/product-cache.feature --clients tests/clients.ts
npx blackbox feature suite emit tests/product-cache.feature \
  --clients tests/clients.ts --output tests/product-cache.generated.spec.ts
npx blackbox feature suite validate tests/product-cache.feature \
  --clients tests/clients.ts --output tests/product-cache.generated.spec.ts
```

Create the output directory first and use a new destination. Do not hand-edit the
emitted suite. Review Feature/Rule/Scenario nesting and the generated assertions;
there is no separate hand-maintained copy of generated output in this guide.

## Execute and inspect

Use your project's existing TypeScript check if configured. Discover and run the suite:

```sh
npx playwright test tests/product-cache.generated.spec.ts --list
npx playwright test tests/product-cache.generated.spec.ts
npx playwright show-report
```

For a single configured project, this Feature should produce two scenario tests.
The number across multiple Playwright projects depends on your configuration.
Inspect executed assertions against C1, C2, and C3; compilation is not evidence
that the database observer works or that all claims passed.

[Sentence reference](reference.md#sentence-reference) ·
[Maintain generated suites](generating-test-suites.md) ·
[Read the evidence](../guides/verify-a-specification.md#read-the-evidence)
