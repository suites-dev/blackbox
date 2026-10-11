# Repair behavior from execution evidence

The API returns `200` and the expected product, but a valid-cache retrieval also queries PostgreSQL.
Repair that behavior **without changing the accepted specification or assertions**.

Complete the [candidate product walkthrough](verify-a-specification.md) first. The referenced sample
is not yet published on this docs branch. This exercise uses its existing calibrated counters,
not the planned effects-snapshot implementation.

![An agent repairs a cache bypass and reruns the same accepted behavior in a separate fresh attempt.](../assets/guides/product-cache-repair.svg)

## Keep the accepted rule fixed

> Creating a product persists it in PostgreSQL and populates Redis. A valid cached retrieval must
> return that product without reading PostgreSQL.

The test enters through HTTP; it does not depend on private method names. Internal code and test
support can change while the same behavior remains required. In the snapshot workflow, an accepted
`.effects.yaml` would remain fixed too. Do not update a baseline to conceal a regression.

## Introduce a cache-bypass defect

In the disposable sample's `app/products.mjs`, change:

```js
if (cached !== null) {
  return JSON.parse(cached);
}
```

into:

```js
if (false && cached !== null) {
  return JSON.parse(cached);
}
```

It still consults Redis but ignores the value and queries PostgreSQL. From `e2e/product-cache/`:

```sh
pnpm --dir .. exec playwright test --config product-cache/playwright.config.ts --project native
```

Use `--project feature` instead if that was your original authoring path. Creation should still
pass. Retrieval should fail its operation assertion despite the correct response. These are expected
exercise outcomes, not execution evidence recorded by this documentation change.

## Distinguish the failed claim from the passing claims

Initial PostgreSQL/Redis state and the response can be correct while C3, cache-only retrieval,
fails. The calibrated observer detects an application PostgreSQL statement inside the bounded
retrieval window. It does not identify a source line or establish that every cache path is defective.
A step not reached after an earlier throwing assertion was not evaluated.

## Give the agent a stable target

A future effects difference needs the same discipline: determine whether it is a behavior change,
a broken implementation, or a changed/incomplete observer. Do not automatically approve new
observations. [Reviewing contract changes](../contracts/reviewing-changes.md).

## Give the agent the discrepancy and its evidence

Preserve the report before a new run replaces it. Use unused destinations:

```sh
cp -R playwright-report playwright-report.failed
cp test-results/results.json results.failed.json
pnpm --dir .. exec playwright show-report product-cache/playwright-report.failed
```

Give the agent the exact failed attempt and the intended rule:

```text
A valid cached retrieval must avoid PostgreSQL. The request returned the right
product, but the observation recorded an application database statement.
Investigate and repair the cache path. Keep the specification, output/state
assertions, and any accepted effects baseline unchanged. Rerun the same scenario
and distinguish implementation failures from observation limitations.
```

A [Capsule](investigate-with-capsule.md) may help test a hypothesis, but starts a different
environment. This small bug may be clear from the report and source without another experiment.

## Repair and rerun

Restore the cache-hit return and execute the same test. Expected Redis GETs remain `1`; application
PostgreSQL statements return to `0`. For generated tests, check alignment before execution:

```sh
pnpm exec blackbox feature suite validate tests/product-cache.feature \
  --clients tests/clients.ts --output tests/product-cache.generated.spec.ts
pnpm --dir .. exec playwright test --config product-cache/playwright.config.ts --project feature
```

Drift validation checks generated files. Execution checks behavior. A future snapshot comparison
needs fresh, adequately scoped observations; it cannot reuse the earlier Capsule result.

## Keep attempt evidence

The documented runner enables `blackboxRetainAttempts: true`. Native tests attach `product-state`
and `retrieval-observations`; attempt records live under `.blackbox/experiments/`. The HTML report
and `test-results/results.json` are separate outputs. Retaining Sandbox artifacts does not archive
the Playwright HTML report automatically. Keep failed and repaired attempt identities separate.

## Keep verifying during development and CI

Use the same accepted expectations with focused local checks and repository-selected CI scope.
A deliberate requirement change is a separate review of spec, scenarios, assertions and relevant
baseline. A refactor that preserves the agreed behavior should not require accepting incidental
new internal spans as part of the contract.

[CI](ci-verification.md) · [Reports](reports.md) · [System setup](../playwright/connect-your-application.md)
