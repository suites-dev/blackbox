# Repair behavior from execution evidence

**Do not move the goalposts when the coding agent's implementation fails.**
The product API may return `200` and correct JSON while violating the
specification: a valid-cache retrieval must avoid PostgreSQL.

This chapter introduces that defect, measures it through a calibrated
observation window, and repairs the implementation **without changing
the accepted requirement or its reviewed expectations**. The evidence
helps the agent investigate, not rewrite a more convenient spec.

Complete [the first verification](verify-a-specification.md) and keep using its
sample in `e2e/product-cache/`. The supplied implementation initially satisfies
the rule. This controlled regression stands in for a defect your agent encounters
while implementing or changing your own application.

![The accepted rule stays fixed while an agent investigates a failed execution, repairs the implementation, and reruns the same expectations.](../assets/guides/product-cache-repair.svg)

## Keep the accepted rule fixed

> Creating a product persists it in PostgreSQL and populates Redis. Retrieving it
> while its cached entry is valid returns the cached product without reading
> PostgreSQL.

The repair changes application code. The specification, native assertions, and
reviewed Feature remain unchanged. Proposed changes to expected behavior
require **separate human review**, not automatic agent adjustment.

## Introduce a cache-bypass defect

In [`app/products.mjs`](../../e2e/product-cache/app/products.mjs), find the
cache-hit branch:

```js
if (cached !== null) {
  return JSON.parse(cached);
}
```

Change its condition to:

```js
if (false && cached !== null) {
  return JSON.parse(cached);
}
```

The service still reads Redis, but now ignores the cached value and continues to
its PostgreSQL query. Make this edit only in the supplied disposable example.
Keep its tests and specification unchanged.

Keep the authoring path you used for the passing run. The commands below show
`--project native`; if you chose the Feature path, use `--project feature` for
each failure and repair run. Both projects express the same accepted rule.

Run your selected scenarios again. Their Sandbox builds and starts the updated
application:

```sh
pnpm --dir .. exec playwright test --config product-cache/playwright.config.ts --project native
```

The creation scenario should still pass. In cached retrieval, setup succeeds and
the GET returns the expected product. The operation assertion fails because the
retrieval issued a PostgreSQL statement despite the valid cached entry.

In either path, changing the expected database count to `1` would change the
agreed behavior and conceal this defect.

## Distinguish the failed claim from the passing claims

The bad implementation still satisfies the HTTP response claim and the
pre-retrieval state checks. It fails **C3: cache-only retrieval** because
a measured PostgreSQL statement occurred in the isolated retrieval window.

The observer was first checked against a known cache miss that must
access PostgreSQL. That positive control supports the negative claim,
within the application-role and observation-window limits. It does
not establish that every cache path is defective or reveal an exact
source line by itself.

Keep the failed attempt and the repaired attempt separate; a step
not reached after an earlier failure was not evaluated.
[Evidence qualification](../concepts/behavioral-evidence.md).

## Give the agent a stable target

The benefit of a reviewed specification is **not** that an agent never makes
mistakes. It's that it can implement, observe a failing check, repair the code,
and rerun **without moving the expected result**. We invest in the check once
so the next implementation is faster to evaluate.

If the existing report isn't enough to explain the failure, start a
[bounded Capsule experiment](investigate-with-capsule.md). It may suggest a
repair, but an experiment's observation doesn't automatically become a new
requirement.

## Give the agent the discrepancy and its evidence

Preserve this failed report before rerunning. Choose an unused
destination if you have already completed the exercise:

```sh
cp -R playwright-report playwright-report.failed
cp test-results/results.json results.failed.json
```

Open the preserved failed report:

```sh
pnpm --dir .. exec playwright show-report product-cache/playwright-report.failed
```

Inspect the failed scenario's steps, actual observation, and matching Blackbox
attempt. Compare the execution to the requirement:

| Observation                                                 | What it tells you                                                                   |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| The product exists in PostgreSQL and Redis before retrieval | The required initial state was established.                                         |
| The GET returns the expected product                        | The response claim holds.                                                           |
| Redis records one GET                                       | The service consulted the cache.                                                    |
| PostgreSQL records one application statement                | The cache-hit path still accessed the database, violating the accepted expectation. |

Give your agent this focused task:

> The accepted rule requires a valid-cache retrieval without a PostgreSQL read.
> The failed attempt returned the expected product but recorded one application
> PostgreSQL statement. Inspect the cache-hit path, repair the implementation,
> and rerun the same scenarios. Keep the accepted expectations fixed.

The counter discrepancy tells the agent where to investigate. It does not identify
a source-code line by itself. Follow the application's retrieval path to see why
it proceeds to the database after finding the cached product.

A [Capsule](../../packages/capsule/README.md) is useful when a hypothesis needs an
interactive experiment. It starts a separate environment; it does not reopen the
finished Playwright attempt. This small defect can be understood from the code
and existing execution evidence without an extra experiment.

## Repair and rerun

Restore the cache-hit return in the application and rerun the unchanged suite:

```sh
pnpm --dir .. exec playwright test --config product-cache/playwright.config.ts --project native
```

Both scenarios should now pass. In the retrieval observation, Redis GETs remain
`1` and application PostgreSQL statements return to `0`. These are new execution
results against the same accepted expectations.

For the Feature path, validate the reviewed Feature and generated suite, then
execute that project:

```sh
pnpm exec blackbox feature suite validate tests/product-cache.feature --clients tests/clients.ts --output tests/product-cache.generated.spec.ts
pnpm --dir .. exec playwright test --config product-cache/playwright.config.ts --project feature
```

The drift check answers whether the suite still matches the Feature. Execution
answers whether the repaired system satisfies its assertions.

## Keep attempt evidence

The supplied runner already enables `blackboxRetainAttempts: true`. Finished
attempt records and Sandbox artifacts are retained under the sample's
`.blackbox/experiments/` directory. Native tests also attach `product-state` and
`retrieval-observations` to the Playwright result before evaluating those values.
Generated scenarios expose the same values through their HTTP response assertions.

The native trace is retained on failure. The HTML report and
`test-results/results.json` are separate Playwright outputs; preserve them before
another invocation replaces them.

Keep the failed and repaired artifacts with their own attempt identities.
Blackbox's retained Sandbox artifacts do not automatically archive Playwright's
HTML report.

## Keep verifying during development and CI

Use the same configuration and accepted expectations locally and in CI. After
preparing the test project, the native path needs:

```sh
pnpm exec tsc --project tsconfig.json
pnpm --dir .. exec playwright test --config product-cache/playwright.config.ts --project native
```

For a generated suite, also run the Feature drift check and select `--project
feature`. Do not manually patch generated assertions; change accepted behavior
through review, then regenerate and execute the suite.

Review, drift checking, and system execution guard different relationships: the
specification to its expectations, a Feature to its generated code, and those
expectations to the running system. Together they keep the requirement in the
verification loop as the implementation changes.

To apply this journey to your product, return to
[agent-assisted application setup](../playwright/connect-your-application.md).
For a new requirement, choose the [observations it needs](README.md).
