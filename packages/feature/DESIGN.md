# Locked design: native clients and Feature suites

Accepted: 2026-10-09. Scope: synchronous tests, client lifecycle, and step context.
This records the agreed target contract. `defineClient`, Sandbox client
registration, automatic client readiness, and the `step` fixture are not
implemented in the current Playwright package. The examples below specify the
API to build. See the
[end-to-end order-pricing example](#end-to-end-example-synchronous-order-pricing)
for the complete flow.

## Authoring contract

Authors import `test`, `expect`, and `defineClient` from
`@suites/blackbox-playwright`. Projects install their chosen JavaScript/TypeScript
SDKs and supply client definitions. Blackbox retains each SDK's native methods and
types, binds it to the selected Sandbox, and owns its attempt-scoped lifecycle.
Tests receive `{ clients, step }` through Playwright fixtures. The `step` fixture
wraps native Playwright `test.step` and establishes the callback's telemetry
context. Generated code obtains it from the test or hook callback.

The catalog remains the authority for acquisition, participants, instrumentation,
and observation. Client definitions select a catalog participant and container
port. Their declarations request the required port exposure before acquisition;
client factories receive the resulting endpoint after the Sandbox is ready.

Client names and types come from the TypeScript registration object. No generated
JSON driver list is required for client autocomplete. Existing command drivers
remain available for their separate command workflows.

## Client definition and suite

Assume the `orders` catalog entry contains a `postgres` participant. The project
installs `pg` and its TypeScript types. This is the canonical proposed shape:

```ts
import pg from 'pg';
import { defineClient, expect, test } from '@suites/blackbox-playwright';

const database = defineClient(pg, {
  target: {
    participant: 'postgres',
    containerPort: 5432,
  },

  env: ['POSTGRES_USER', 'POSTGRES_PASSWORD', 'POSTGRES_DB'] as const,

  create: (sdk, { endpoint, env }) =>
    new sdk.Pool({
      host: endpoint.host,
      port: endpoint.port,
      user: env.POSTGRES_USER,
      password: env.POSTGRES_PASSWORD,
      database: env.POSTGRES_DB,
    }),

  ready: async (pool) => {
    await pool.query('SELECT 1');
  },

  dispose: (pool) => pool.end(),
});

test.system('orders', (system) => {
  system.sandbox('default', { clients: { db: database } }, (suite) => {
    suite.test('can query the database', async ({ clients, step }) => {
      const result = await step('When I query the database', () =>
        clients.db.query('SELECT 1 AS value'),
      );
      await step('Then the query returns one', async () => {
        expect(result.rows).toEqual([{ value: 1 }]);
      });
    });
  });
});
```

`clients.db` is inferred as the created `pg.Pool`, including its SDK method types.
Async factories are supported; the exposed type is the resolved client type.
The Sandbox name is a configuration group, not a shared live resource or a named
profile already present in the catalog schema.

The `env` tuple declares required keys. The factory receives only those keys,
each typed as `string`. Values come from the selected participant's effective
container environment for this attempt. Missing required keys fail setup before
client creation. Host and mapped port come from `endpoint`, independently of
container environment variables. Diagnostics must redact credentials.

## Step fixture

The locked authoring shape is `suite.test(title, async ({ clients, step }) => ...)`.
`step` is a test-scoped fixture bound to the current physical attempt. It is also
available to `suite.beforeEach` and `suite.afterEach`, so Backgrounds and the body
use the same attempt while each step invocation has its own identity. Declaration
callbacks and `beforeAll` / `afterAll` have no attempt-scoped `step` fixture.

The fixture keeps the native call shape `step(title, body, options?)`. It preserves
the callback's inferred return value, `TestStepInfo`, native step options, error
behavior, nesting, and reporting. Returning an HTTP response still returns that
SDK response directly. Authors pass no activity handle or telemetry context.

For each invocation, Blackbox must:

1. Associate a fresh step identity and span with the fixture's attempt.
2. Run the body inside that active asynchronous context and a native Playwright
   step. Supported client integrations can read the context at call time.
3. Preserve parent context for nested steps and isolate concurrent callbacks.
   A mutable process-wide "current step" is insufficient.
4. Close the local span and restore the caller's context when the callback
   succeeds or throws, preserving native timeout and cancellation behavior.

Retries receive new fixture instances and identities. Internal activity records
may support correlation, but activities stay out of the authoring API. Native
suites and generated suites use the same fixture; no Gherkin runtime is required.
The existing declaration-level `suite.step()` / `test.step()` pass-throughs do not
provide this proposed context behavior. Generated suites use the fixture.

## Startup and teardown

An automatic Playwright fixture initializes every client registered for the
Sandbox group, even if a test callback does not request `clients` explicitly.
All clients must pass their declared `ready` checks before any per-test hook runs.
Construction alone is not proof of connectivity.

```text
Resolve catalog and declared client targets
  -> acquire Sandbox and wait for participant readiness
  -> verify configured instrumentation activation
  -> validate required client environment
  -> create clients and run readiness checks
  -> expose attempt-bound clients and step fixtures to hooks and body
  -> Feature Background
  -> Rule Background, when present
  -> test body and per-test teardown hooks
  -> dispose clients
  -> release Sandbox
```

Each physical attempt, including every retry, owns fresh clients and a fresh
Sandbox. Feature and Rule hooks share those clients and the attempt-bound `step`
fixture with that attempt's body. Readiness runs before user steps and keeps its
own setup attribution; it cannot be assigned to the first `When`.
A readiness failure prevents hooks and the test body from starting. Cleanup must
be attempted for every created client and the Sandbox on setup failure, assertion
failure, timeout, or interruption; one disposal failure must not skip the rest.
A factory that allocates resources and then throws must release its partial work.
Setup and cleanup are bounded by the runner's lifecycle timeout budgets.

The reporter shows client names and startup states, for example `api connected`,
`db connected`, and `cache connected`, without exposing environment values.

## Feature to suite

The Feature package compiles source into the same public Playwright API used by
native authors. It consumes supplied client bindings and explicit vocabulary
compilation rules; it does not infer arbitrary SDK methods from prose. Generated
callbacks destructure `{ clients, step }`, call native SDK methods, retain local
response variables, and use ordinary assertions. Features remain optional.

| Gherkin                   | Playwright output                                           |
| ------------------------- | ----------------------------------------------------------- |
| Feature                   | Outer `suite.describe()`                                    |
| Rule                      | Nested `suite.describe()`                                   |
| Feature / Rule Background | `suite.beforeEach()` at the owning level                    |
| Scenario                  | `suite.test()`                                              |
| Scenario Outline          | `suite.describe()` containing one test per Examples row     |
| Examples                  | Values and distinct block/row identities in test titles     |
| Given / When / Then       | Fixture `step()` wrapping compiled operations or assertions |
| And / But / *             | Same mapping, preserving the authored keyword in the title  |
| Data Table / Doc String   | Validated arguments or expected values                      |
| Ordinary authored tags    | Native tag details at the corresponding scope               |

`And` and `But` continue the previous Gherkin step type. `*` is a neutral
bullet step with no Given/When/Then type of its own. The compiler validates the
sentence and its arguments and preserves the original keyword in the native
`step()` title; the keyword alone never selects a client method or assertion.

Outline rows are declared synchronously with `Array.forEach()`, following
[Playwright parameterization](https://playwright.dev/docs/test-parameterize).
Each iteration declares an independent `suite.test()` with its own fixtures,
retry lifecycle, and row identity. Background hooks stay at their owning describe
scope. Playwright has no native `test.each()` API.

Catalog and Sandbox selectors compile into boundary declarations. Do not invent
synthetic tags. Preserve step order, including multiple Act/Assert sequences.
Arrange prepares state; Act invokes the client; Assert checks the result. A
synchronous operation completes its specified behavior before its response is
asserted; network calls still use `await`.

Generated bodies need no `scenario.execute()`, activity wrappers, `world` fixture,
source URL, line objects, or `featureDetails()`. Structural drift compares a
normalized Gherkin tree with the supported emitted TypeScript structure. It must
not claim equivalence for arbitrary handwritten TypeScript.

## Instrumentation and evidence

Blackbox provisions the collector and activates configured participant
instrumentation. The physical Sandbox attempt remains the collection and
isolation boundary, including readiness, setup, inspection, and teardown traffic.
A Scenario or Examples row owns an attempt; a retry owns a new one.

| Scope            | Evidence contract                                                                                                            |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Attempt          | Retains telemetry belonging to that Sandbox execution.                                                                       |
| Fixture `step()` | Establishes a local span and async context associated with the attempt.                                                      |
| Client operation | Joins the active step through compatible client instrumentation or an explicit integration.                                  |
| Application work | Can be associated with the step when context is carried across the boundary and consumed by the application instrumentation. |

`defineClient` owns connections and lifecycle. Registering an arbitrary SDK does
not instrument it. A supported client integration must read the active context
for each operation, carry it in HTTP headers or message metadata, and cooperate
with context extraction on the receiving side. A single context captured during
client creation would incorrectly combine subsequent steps. Integration details
and configuration still need implementation; the `step` fixture alone cannot
supply transport propagation. This follows the
[OpenTelemetry propagation model](https://opentelemetry.io/docs/languages/js/propagation/).

Correlate evidence using recorded identities and trace relationships. Shared
trace IDs or overlapping timestamps alone do not separate nested or sibling
steps. Preserve attribution when telemetry arrives after a callback finishes.
A step finishing means its awaited body finished; it does not prove that all
remote work or telemetry export has completed.

`telemetry.read()` remains an attempt-wide read, including when called inside a
step. `telemetry.readTrace(traceId)` selects a trace and does not automatically
select the current step. A public selector for a prior step's effects is not
locked here. A `Then` step asserting a response does not adopt the preceding
`When` step's context; future effect assertions must identify the stimulus whose
evidence they evaluate while preserving the normal step return value.

If a boundary cannot propagate context, retain its evidence at attempt scope and
report missing causal correlation. For example, a plain Redis shared-state write
does not link later consumer work without a carrier/consumer convention. Client
readiness proves its connectivity check, independently of telemetry capture.
Public activity wrappers remain unnecessary. Async completion/drain contracts and
changes to effects evaluation remain outside this synchronous lock.

## End-to-end example: synchronous order pricing

This example connects the catalog, a supplied HTTP client, a Feature, and the
suite it should produce. The client API, `step` fixture, and compiler output below
are the target design, not an executable example of the current package.

The project supplies a local `orders-api:e2e` image: a CommonJS Node application
listening on container port `3000`, with empty in-memory state at startup. Its
synchronous API has this contract:

| Endpoint                   | Behavior                                                         |
| -------------------------- | ---------------------------------------------------------------- |
| `GET /health`              | Public readiness check; returns `200`.                           |
| `GET /products`            | Authenticated connectivity check; returns `200` and a JSON list. |
| `POST /products`           | Stores `{ sku, price, stock }`; returns `201`.                   |
| `PATCH /products/:sku`     | Updates stock; returns `200` after the update.                   |
| `POST /quotes`             | Returns `200` with `{ sku, quantity, total }` for valid input.   |
| `POST /quotes`, quantity 0 | Returns `422` with `{ code: "INVALID_QUANTITY" }`.               |
| `POST /quotes`, over stock | Returns `409` with `{ code: "INSUFFICIENT_STOCK" }`.             |

All endpoints except `/health` require the fixture's bearer token. Prices are
integer minor units. Quotes do not reserve stock. This application contract and
image are assumptions of the example; the Feature compiler does not build the
application.

```text
blackbox.config.yaml
.blackbox/catalog/orders.yaml
.blackbox/instrumentation/       # installed Node instrumentation assets
playwright.config.ts
e2e/clients.ts
e2e/features/order-pricing.feature
e2e/generated/order-pricing.spec.ts
```

### Infrastructure and instrumentation

`.blackbox/catalog/orders.yaml` starts the project-owned image. The credential is
a disposable example value. Docker allocates a host port on loopback; the client
never hardcodes that port.

```yaml
services:
  public-api:
    image: orders-api:e2e
    init: true
    restart: 'no'
    environment:
      PORT: '3000'
      FIXTURE_CONTROL_TOKEN: local-example-only
    ports:
      - '127.0.0.1::3000'
```

`blackbox.config.yaml` selects the subsystem and declares instrumentation. The
schema still requires `drivers`; an empty map is valid for this client-based
suite.

```yaml
schemaVersion: 1
catalog:
  default: orders
  entries:
    orders:
      kind: subsystem
      acquisition:
        adapter: docker-compose@1
        files:
          - .blackbox/catalog/orders.yaml
      entrypoint:
        participant: public-api
        protocol: http
        containerPort: 3000
        readiness:
          path: /health
          timeoutMs: 30000
      participants:
        public-api:
          service: public-api
          role: entrypoint
          runtime: node
          activation: node-runtime
      drivers: {}
      observation:
        policyId: orders-http-v1
        boundaries:
          - id: effects.http
            kind: http
            authoritativeFor:
              - HTTP effects
        requiredBoundaries:
          - effects.http
        terminalObservationWindowMs: 500
        redaction:
          requestBodies: not-captured
          headers:
            - authorization
          dynamicIdentifiers: normalized
activations:
  node-runtime:
    ref: .blackbox/instrumentation/instrumentation.js
    adapter: node-preload
    version: 1
```

With the Blackbox CLI and Node instrumentation package installed in the consuming
project, the existing setup command creates `.blackbox/instrumentation/`:

```sh
pnpm exec blackbox inst install --runtime node
```

The `node-preload` activation fits this image's CommonJS entrypoint. Sandbox
mounts the installed assets, enables the preload before the application starts,
and directs its telemetry to the attempt's collector. See
[Node instrumentation installation](../instrumentation-runtime-node/README.md)
for the current installation contract. The observation policy describes intended
coverage; this example does not assert an effects contract.

### Supplied client and typed environment

`e2e/clients.ts` supplies Playwright's installed HTTP SDK. `request.newContext()`
creates an `APIRequestContext`; no browser is needed.

```ts
import { request } from '@playwright/test';
import { defineClient, expect } from '@suites/blackbox-playwright';

export const api = defineClient(request, {
  target: {
    participant: 'public-api',
    containerPort: 3000,
  },
  env: ['FIXTURE_CONTROL_TOKEN'] as const,

  create: (sdk, { endpoint, env }) =>
    sdk.newContext({
      baseURL: endpoint.url,
      extraHTTPHeaders: {
        authorization: `Bearer ${env.FIXTURE_CONTROL_TOKEN}`,
      },
    }),

  ready: async (client) => {
    const response = await client.get('/products');
    expect(response.status()).toBe(200);
  },

  dispose: (client) => client.dispose(),
});
```

At authoring time, `env.FIXTURE_CONTROL_TOKEN` is a `string`; an undeclared key is
a type error. At runtime, its value comes from the selected `public-api`
container. The endpoint uses its mapped host port and the catalog entrypoint's
HTTP protocol. Missing environment or failed authenticated readiness stops setup
before any Background runs.

Registration as `{ clients: { api } }` gives hooks and tests an inferred
`clients.api: APIRequestContext`. The factory runs once per physical attempt,
including retries. Importing this definition during test discovery opens no
connection. Blackbox awaits the asynchronous factory and its readiness check.

This client definition supplies connection and authentication. Creating an
`APIRequestContext` alone does not enable step-to-application propagation. The
runtime still needs a supported integration that injects the active step context
on each request. The suite below demonstrates response assertions; it does not
claim that SDK registration alone supplies causally scoped application evidence.

### Feature source

`e2e/features/order-pricing.feature` covers Feature and Rule Backgrounds, an
ordinary Scenario, an Outline, Examples, tags, JSON Doc Strings, and a Data Table.
Here `@subsystem:orders` and `@sandbox:default` are proposed compiler selectors;
`@sync` and `@validation` are ordinary native report/filter tags.

```gherkin
@subsystem:orders @sandbox:default @sync
Feature: Order pricing
  Background: A product is available
    Given client "api" has sent POST "/products" with JSON and received 201:
      """json
      { "sku": "keyboard", "price": 100, "stock": 3 }
      """

  Rule: Valid quantities produce a quote
    Scenario: Quote two keyboards
      When client "api" sends POST "/quotes" with JSON:
        """json
        { "sku": "keyboard", "quantity": 2 }
        """
      Then the response status is 200
      * the response JSON contains these fields:
        | field    | json       |
        | sku      | "keyboard" |
        | quantity | 2          |
        | total    | 200        |

  @validation
  Rule: Quantities must be positive and within available stock
    Background: Only one item is available
      Given client "api" has sent PATCH "/products/keyboard" with JSON and received 200:
        """json
        { "stock": 1 }
        """

    Scenario Outline: Reject quantity <quantity>
      When client "api" sends POST "/quotes" with JSON:
        """json
        { "sku": "keyboard", "quantity": <quantity> }
        """
      Then the response status is <status>
      But the response JSON contains:
        """json
        { "code": "<code>" }
        """

      Examples: Rejected quantities
        | quantity | status | code               |
        | 0        | 422    | INVALID_QUANTITY   |
        | 2        | 409    | INSUFFICIENT_STOCK |
```

The compiler receives this source, the `api` binding from `e2e/clients.ts`, and
compilation rules for these sentences. This is the example vocabulary to
implement, not a claim that the current older vocabulary already accepts it:

| Sentence / argument                       | Emitted behavior                                               |
| ----------------------------------------- | -------------------------------------------------------------- |
| `has sent METHOD ... and received STATUS` | Send setup request and assert its status.                      |
| `sends METHOD ... with JSON`              | Call the registered HTTP client; retain the local response.    |
| `the response status is STATUS`           | Assert the preceding response's status.                        |
| `the response JSON contains` + Doc String | Parse expected JSON and emit `toMatchObject`.                  |
| `... contains these fields` + Data Table  | Parse each `json` cell into an expected top-level field value. |

Outline substitution happens before JSON parsing. Unknown clients, unsupported
sentences, invalid JSON, duplicate table fields, or assertions without a prior
response fail compilation. The compiler validates this HTTP binding against the
Playwright client types; knowing a client's name alone cannot determine its SDK
methods. CLI spelling and binding configuration remain provisional.

### Generated native suite

`e2e/generated/order-pricing.spec.ts` contains ordinary calls and assertions.
This is the proposed complete emitted file, with no runtime step interpreter:

```ts
import { expect, test } from '@suites/blackbox-playwright';
import { api } from '../clients.js';

test.system({ kind: 'subsystem', id: 'orders' }, (system) => {
  system.sandbox('default', { clients: { api } }, (suite) => {
    suite.describe('Feature: Order pricing', { tag: ['@sync'] }, () => {
      suite.beforeEach('Background: A product is available', async ({ clients, step }) => {
        await step(
          'Given client "api" has sent POST "/products" with JSON and received 201:',
          async () => {
            const response = await clients.api.post('/products', {
              data: { sku: 'keyboard', price: 100, stock: 3 },
            });
            expect(response.status()).toBe(201);
          },
        );
      });

      suite.describe('Rule: Valid quantities produce a quote', () => {
        suite.test('Scenario: Quote two keyboards', async ({ clients, step }) => {
          const response = await step('When client "api" sends POST "/quotes" with JSON:', () =>
            clients.api.post('/quotes', { data: { sku: 'keyboard', quantity: 2 } }),
          );
          await step('Then the response status is 200', async () => {
            expect(response.status()).toBe(200);
          });
          await step('* the response JSON contains these fields:', async () => {
            expect(await response.json()).toMatchObject({
              sku: 'keyboard',
              quantity: 2,
              total: 200,
            });
          });
        });
      });

      suite.describe(
        'Rule: Quantities must be positive and within available stock',
        { tag: ['@validation'] },
        () => {
          suite.beforeEach('Background: Only one item is available', async ({ clients, step }) => {
            await step(
              'Given client "api" has sent PATCH "/products/keyboard" with JSON and received 200:',
              async () => {
                const response = await clients.api.patch('/products/keyboard', {
                  data: { stock: 1 },
                });
                expect(response.status()).toBe(200);
              },
            );
          });

          suite.describe('Scenario Outline: Reject quantity <quantity>', () => {
            const examples = [
              { quantity: 0, status: 422, code: 'INVALID_QUANTITY' },
              { quantity: 2, status: 409, code: 'INSUFFICIENT_STOCK' },
            ] as const;

            examples.forEach(({ quantity, status, code }, row) => {
              suite.test(
                `Examples 1: Rejected quantities / row ${row + 1}: Reject quantity ${quantity}`,
                async ({ clients, step }) => {
                  const response = await step(
                    'When client "api" sends POST "/quotes" with JSON:',
                    () =>
                      clients.api.post('/quotes', {
                        data: { sku: 'keyboard', quantity: quantity },
                      }),
                  );
                  await step(`Then the response status is ${status}`, async () => {
                    expect(response.status()).toBe(status);
                  });
                  await step('But the response JSON contains:', async () => {
                    expect(await response.json()).toMatchObject({ code: code });
                  });
                },
              );
            });
          });
        },
      );
    });
  });
});
```

The native hierarchy contains three tests: one Scenario and two Examples rows.
Each row gets its own Sandbox, clients, and response variable. Feature Background
runs before Rule Background for every row; the first Rule has no Rule Background.
The block and row positions keep titles unique even if example values repeat.
Tests and Background hooks destructure `{ clients, step }`, making their fixture
dependencies visible to Playwright. Background steps establish Arrange contexts;
each `When` and `Then` establishes its own context in the same attempt.

### Runner and attempt lifecycle

`playwright.config.ts` selects the catalog and generated test directory:

```ts
import { defineConfig } from '@suites/blackbox-playwright/config';

export default defineConfig({
  blackboxConfigFile: './blackbox.config.yaml',
  testDir: './e2e/generated',
  fullyParallel: true,
  timeout: 60_000,
  retries: 1,
  reporter: [
    ['list', { printSteps: true }],
    ['@suites/blackbox-playwright/reporter', { sandboxLifecycle: true }],
    ['html', { open: 'never' }],
  ],
});
```

After implementing client registration, the `step` fixture, and compilation, the
intended workflow is Feature validation and emission, followed by the ordinary
runner command:

```sh
pnpm exec playwright test --config=playwright.config.ts
```

The compiler should produce the three tests above. This command cannot run the
proposed client and step APIs in the current checkout. The client module is shared
project code; it is not regenerated with each Feature.

For the `quantity = 2` rejection row, the complete attempt is:

| Stage                    | What happens                                                                     |
| ------------------------ | -------------------------------------------------------------------------------- |
| Acquire                  | Start fresh `orders` containers and collector; enable Node instrumentation.      |
| Infrastructure readiness | Wait for `/health`; resolve the mapped endpoint and required environment.        |
| Client readiness         | Create `api`; authenticated `GET /products` must return `200`.                   |
| Arrange                  | Feature Background creates stock `3`; Rule Background reduces it to `1`.         |
| Act / stimulus           | Native `clients.api.post('/quotes', ...)` requests quantity `2`.                 |
| Assert                   | Check status `409` and JSON code `INSUFFICIENT_STOCK`.                           |
| Teardown                 | Run per-test teardown hooks; dispose `api`; retain evidence and release Sandbox. |

The setup HTTP calls are Arrange even though they produce telemetry. The quote
request is the test's Act/stimulus. The fixture's `step()` creates its local
context and native report entry. With a supported HTTP propagation integration,
application spans can be correlated to that stimulus separately from Background
steps. Without that integration, application evidence remains associated with the
attempt and cannot be claimed as caused by this `When`. The following `Then`
steps assert the saved response and create their own local contexts. Telemetry
may arrive after the request and step have finished.

If connectivity fails, neither Background nor the body runs. If an assertion
fails, disposal and Sandbox release still run. A retry repeats the entire attempt
with fresh resources. A project that chooses no Feature files writes the same
suite directly and keeps the same catalog, client module, fixtures, and lifecycle.

## Implementation handoff

Playwright owns the new public client contract, type inference, acquisition
integration, automatic readiness, the attempt-bound `step` fixture, lifecycle
reporting, and cleanup. It also owns integration with supported client
instrumentation and the association between attempt, step, and trace identities.
Feature depends on those public types and emits fixture-based steps through its
compiler and CLI surface.

The syntax is locked; transport integrations, evidence selectors, and completion
semantics still require concrete contracts. Implementation must verify native
step return values and reporting, fixture availability in tests and per-test
hooks, retry isolation, nested/concurrent context isolation, failure cleanup, and
both propagated and uncorrelated operations. No document example establishes that
these runtime behaviors already work.

The current checkout has a parser, vocabulary, older step runtime, and no-op CLI
commands. The compiler and requested snapshot fixtures still need implementation.
Future snapshots should live under `packages/feature/test`, using meaningfully
named TypeScript fixtures that default-export a Feature string and tests that call
`toMatchSnapshot()` on emitted suites. Snapshot acceptance also needs generated
TypeScript checking and Playwright discovery; it does not prove client lifecycle
or telemetry behavior.

Sources: [Playwright public types](../playwright/src/types.ts),
[Sandbox connection inspection](../sandbox/src/inspection/sandbox-container.ts),
[catalog schema](../catalog/schema/blackbox-config-v1.json), and the
[Redis example of missing causal propagation](../../e2e/journeys/04-redis.golden).
