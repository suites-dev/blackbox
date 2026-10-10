# Verify a specification against your system

You and your coding agent have an **accepted specification**: product creation
must persist to PostgreSQL and populate Redis; retrieving a cached product must
not read PostgreSQL. Blackbox lets the agent turn that rule into executable
expectations, run the real system, and inspect the evidence needed for each
claim before accepting or repairing the implementation.

This is **Spec-Driven Verification**, not simply test generation. Follow one
requirement from accepted intent through claim selection, system setup, native
Playwright or optional Gherkin, evidence review, and an unchanged-expectation
repair. The selected application contains a product service, PostgreSQL,
and Redis. [Read the model](../concepts/spec-driven-verification.md).

This candidate-alpha walkthrough requires the pending typed Playwright client API
and the `e2e/product-cache/` sample, which are not yet included in this checkout.
Read the journey here; run its commands only from a checkout containing those
dependencies. See [current availability](../../README.md#alpha-and-further-guides).

![The specification guides setup, reviewed tests, the product system, and the execution report.](../assets/guides/product-cache-journey.svg)

## Start with the accepted behavior

The source specification is
[`specs/create-product.md`](../../e2e/product-cache/specs/create-product.md):

> Creating a product persists it in PostgreSQL and populates Redis. Retrieving it
> while its cached entry is valid returns the cached product without reading
> PostgreSQL.

The developer approves the rule. The agent proposes concrete checks and
identifies how to observe each result:

| What the spec requires | What we'll actually check |
| --- | --- |
| **Save the product** | The expected PostgreSQL row, read after creation |
| **Populate the cache** | The expected value in Redis |
| **Serve a valid cache hit** | The correct response, one Redis GET, and **zero application PostgreSQL operations** during retrieval |

The last requirement says something **must not happen**. So the example
first checks that its database observer can detect a known SQL read, then
measures one cache-hit retrieval in a controlled window. An absent trace
span by itself would not be enough.

The walkthrough covers creation and immediate retrieval. Expiry,
invalidation, and concurrent requests would need their own agreed rules.
[Why these observations matter](../concepts/behavioral-evidence.md).

## Let the agent prepare the system

Give your agent the specification and a concrete task:

> Set up Blackbox to verify this accepted specification. Discover the product
> service, PostgreSQL, and Redis; select the smallest runnable boundary that
> preserves the required behavior. Configure the Sandbox and its clients.
> Map C1, C2, and C3 to observations and completion boundaries. Prepare the
> scenarios for my review. Do not change the accepted behavior to match the
> current implementation.

In your own repository, follow [agent-assisted setup](../playwright/connect-your-application.md).
The agent derives the topology and creates or reuses the configuration and test
support files. A Sandbox is the isolated running instance of that selected system
for one test attempt. The suite invokes it and connects the clients; Blackbox
manages the environment while the test checks the accepted behavior.

The supplied example already contains that setup. Its main artifacts are:

| Artifact in `e2e/product-cache/`        | Purpose                                              |
| --------------------------------------- | ---------------------------------------------------- |
| `specs/create-product.md`               | The accepted behavior carried through the tests.     |
| `blackbox.config.yaml`                  | The product service, PostgreSQL, and Redis boundary. |
| `tests/clients.ts`                      | The client connection for the current Sandbox.       |
| `tests/product-cache.native.spec.ts`    | Handwritten Playwright expectations.                 |
| `tests/product-cache.feature`           | Optional reviewed Gherkin source.                    |
| `tests/product-cache.generated.spec.ts` | The suite generated from that Feature.               |
| `playwright.config.ts`                  | Test discovery, authoring projects, and reports.     |

### Run the supplied example

Use a Blackbox source checkout containing the typed client API and the complete
`e2e/product-cache/` sample, plus the Feature compiler if you choose that path.
You need Node.js 22.15 or later, pnpm 9.15.4, and a running Docker engine with Compose. The first run needs network
access to obtain dependencies and images. No browser download is needed for these
API tests.

<details>
<summary>First time using this source checkout</summary>

From the repository root, install the pinned dependencies and compile Blackbox:

```sh
pnpm install --frozen-lockfile
pnpm build
```

These are source-checkout preparation steps. The Playwright invocation below
builds and starts the sample application through its Sandbox configuration.

</details>

From a prepared checkout, enter the sample:

```sh
cd e2e/product-cache
```

**Run all remaining commands in this walkthrough and the repair chapter from
`e2e/product-cache/`.** Playwright is owned by the parent E2E workspace, so its
commands use `pnpm --dir ..` and a `product-cache/` path.

```sh
pnpm exec blackbox catalog validate --json
```

Catalog validation must report `"ok": true`. When Playwright invokes the Sandbox,
Blackbox builds the configured application, starts a fresh isolated system, waits
for readiness, and connects the clients. After the attempt, it closes the clients
and releases the environment. The same test command runs your updated application
after an implementation change.

## Review the executable expectations

![Reviewed native Playwright or optional Gherkin scenarios run through the same Sandbox and evidence path.](../assets/guides/authoring-paths.svg)

The two scenarios keep Arrange, Act, and Assert visible:

| Scenario         | Arrange                                                               | Act                       | Assert                                                           |
| ---------------- | --------------------------------------------------------------------- | ------------------------- | ---------------------------------------------------------------- |
| Creation         | A fresh isolated product system                                       | Create the product        | Expected response, PostgreSQL row, and Redis value               |
| Cached retrieval | Create the product, verify its state, and begin an observation window | Retrieve the product once | Expected response, one Redis GET, and zero PostgreSQL statements |

The cached-retrieval scenario first checks that its observation mechanism detects
a real database read on a cache miss. It then creates the product used by the
scenario. This prevents an inactive observer from passing the absence check.

Both scenarios use this product:

```json
{ "id": "product-1", "name": "Field notebook", "priceCents": 1299 }
```

### Native Playwright

Open the [complete native suite](../../e2e/product-cache/tests/product-cache.native.spec.ts).
Its Feature and Rule groups preserve the relationship to the specification;
Scenario tests carry the concrete examples. Named steps separate setup, action,
and assertions in the report.

Within the cached-retrieval scenario, after establishing its preconditions:

```ts
const response = await step('When the product is retrieved once', () =>
  clients.api.get('/products/product-1'),
);

await step('Then the cached product is returned without a PostgreSQL read [C3]', async () => {
  const inspection = await clients.api.get('/fixture/observations/result');
  const observations: unknown = await inspection.json();
  await testInfo.attach('retrieval-observations', {
    body: JSON.stringify(observations, null, 2),
    contentType: 'application/json',
  });
  expect(response.status()).toBe(200);
  expect(await response.json()).toMatchObject(product);
  expect(inspection.status()).toBe(200);
  expect(observations).toEqual({
    productId: product.id,
    applicationPostgresSelects: 0,
    applicationPostgresStatements: 0,
    applicationPostgresPlans: 0,
    redisGets: 1,
    retrievals: 1,
  });
});
```

The `/fixture/` requests are protected observation endpoints owned by this example
application. They inspect real PostgreSQL and Redis state and operation counters.
They are not built-in Blackbox commands. In your project, use the observation
surfaces appropriate to your requirement.

### Optional Gherkin Feature

If your team reviews behavior in Gherkin, follow
[the Feature authoring path](../features/drafting-feature-files.md). It uses the
same product, rule, clients, and observations, then rejoins this walkthrough at
execution and evidence review.

Blackbox adopts Gherkin through Cucumber's parser. Supported sentences generate
native Playwright declarations while preserving Feature → Rule → Scenario nesting
and authored step order. The current compiler supports HTTP sentences, so the
example uses its project-owned observation endpoints for state and counter checks.
Registering a Redis SDK does not introduce new Gherkin sentences.

Review the executable scenarios against the source specification whichever path
you choose. Generation does not establish that every requirement was captured.

## Execute the accepted expectations

The native suite declares the system and clients it needs:

```ts
test.system('product-system', (system) => {
  system.sandbox('default', { clients: { api } }, (suite) => {
    // Feature, Rule, and Scenario declarations live here.
  });
});
```

That declaration brings up the configured system when a scenario executes.
Check the TypeScript, confirm discovery, and run the native route:

```sh
pnpm exec tsc --project tsconfig.json
pnpm --dir .. exec playwright test --config product-cache/playwright.config.ts --project native --list
pnpm --dir .. exec playwright test --config product-cache/playwright.config.ts --project native
```

Discovery must show **two scenarios**, creation and cached retrieval, under the
same Feature and Rule. Execution should pass both. For the generated route, use
`--project feature` after the Feature validation and generation steps. You only
need one authoring route to complete the journey.

Open the report:

```sh
pnpm --dir .. exec playwright show-report product-cache/playwright-report
```

## Read the evidence

Follow the accepted rule into the executed steps. A green response assertion
alone does not establish the database and cache claims.

![Creation stores the product in PostgreSQL and Redis. A valid-cache retrieval reads Redis without a PostgreSQL read; bypassing the cache breaks that requirement despite the same response.](../assets/guides/product-cache-evidence.svg)

| Claim                                                            | Evidence to inspect                                                                                                    |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| The product was persisted                                        | The creation scenario's PostgreSQL state assertion.                                                                    |
| The cache was populated                                          | The same scenario's Redis value assertion, before retrieval.                                                           |
| The product was retrieved from the cache without a database read | The retrieval's correct response, one Redis GET, and zero application PostgreSQL statements in its observation window. |

<details>
<summary>How the sample observes the retrieval</summary>

The sample reads PostgreSQL's `pg_stat_statements` counters for the application
role and Redis's `INFO commandstats`. Fixture queries use a separate database role.
State inspection happens before the retrieval window. The isolated system has no
other application traffic during that window, so the deltas describe the selected
retrieval. See [Redis verification](testing-redis.md) for how to preserve that
boundary when adapting the example.

These are explicit assertions over database and cache observations. They do not
rely on a missing telemetry span or the alpha effects matcher. In a busier system,
choose an observation mechanism that distinguishes the relevant request from
concurrent activity.

</details>

Expand the Blackbox attempt and lifecycle attachments too. They identify the
Sandbox that ran the scenario and its diagnostics. If an assertion fails, later
steps after that throwing assertion may not have run; do not count them as passed.

You now have a specification connected to executable checks and evidence from a
real system. Continue directly to **[repairing an implementation defect against
these same expectations](repair-from-evidence.md)**.

## Qualify the result, not merely the process

A real Playwright pass means that its **executed assertions passed**. It
doesn't mean every statement in `specs/create-product.md` was represented, or
that all external effects were observed.

Distinguish a supported claim, a contradictory observation, and a claim
**not evaluated** because an earlier step failed, an observer was absent,
or completion never occurred. These are evidence-reasoning categories, not
a three-valued result automatically promised by the alpha.

Keep attempt identity, initial state, observed values, and the calibrated
window with each finding so a reviewer can follow the result back to the
accepted rule. [Evidence guidance](../concepts/behavioral-evidence.md).

## Resolve a first-run failure

| Failure                           | Next action                                                                                       |
| --------------------------------- | ------------------------------------------------------------------------------------------------- |
| Source-checkout preparation fails | Resolve the reported toolchain, Docker, or network error before interpreting test results.        |
| Catalog validation fails          | Check the current directory and ask the agent to correct the reported configuration error.        |
| No scenarios are discovered       | Check the config and project selection against the commands above.                                |
| The Sandbox cannot start          | Inspect Blackbox's lifecycle diagnostics; the business assertions have not run.                   |
| Calibration fails                 | Repair the observation setup before trusting a zero-read result.                                  |
| An accepted expectation fails     | Follow the failed step and its observed value into the [repair chapter](repair-from-evidence.md). |
