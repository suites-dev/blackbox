# Check the response promised by the specification

The [product specification](../../e2e/product-cache/specs/create-product.md) starts
with a visible result: creating and retrieving a product returns its data through
the API. Check that response as part of the same scenario that verifies
persistence, cache population, and cache-only retrieval.

Follow [Verify a specification against your system](verify-a-specification.md)
for the complete runnable example. This guide explains its HTTP action and
response checks. The [canonical native suite](../../e2e/product-cache/tests/product-cache.native.spec.ts)
keeps them connected to the other accepted claims.

## A response is an entrypoint outcome

An HTTP status and body establish what the application returned at
that boundary. They do **not** prove a committed database write,
cache population, or the absence of a forbidden downstream operation.
The accepted spec determines whether those require separate claims.

[Outcome, state, and effect evidence](../concepts/behavioral-evidence.md).

## Connect the API client

The sample's [client definition](../../e2e/product-cache/tests/clients.ts) binds
Playwright's request SDK to the current attempt's API:

```ts
import { request } from '@playwright/test';
import { defineClient, expect } from '@suites/blackbox-playwright';

export const api = defineClient(request, {
  target: { participant: 'product-service', containerPort: 3000 },
  env: ['FIXTURE_CONTROL_TOKEN'] as const,
  create: (sdk, { endpoint, env }) =>
    sdk.newContext({
      baseURL: endpoint.url,
      extraHTTPHeaders: { authorization: `Bearer ${env.FIXTURE_CONTROL_TOKEN}` },
    }),
  ready: async (client) => {
    expect((await client.get('/health')).status()).toBe(200);
  },
  dispose: (client) => client.dispose(),
});
```

Blackbox supplies the resolved endpoint and requested container environment values.
The sample's token authorizes its fixture inspection and observation operations.
Your application needs its own authentication and fixture contract.

Register `{ clients: { api } }` in the Sandbox declaration. The test receives a
ready `clients.api` and uses the SDK's normal `get`, `post`, and response methods.
A manually created request context uses the options passed to `newContext`; it
does not inherit the built-in `request` fixture's project options.

## Match the accepted response fields

The creation scenario sends this product through the application. These lines
belong inside the canonical test's action and response steps:

```ts
const product = { id: 'product-1', name: 'Field notebook', priceCents: 1299 };
const created = await clients.api.post('/products', { data: product });
expect(created.status()).toBe(201);
expect(await created.json()).toMatchObject(product);
```

The status checks the response class; the JSON assertion checks the promised
product fields. Both native and Feature versions use partial response matching,
so additional response fields are permitted. Use an exact-body assertion only
when the accepted contract requires the complete response shape.

The retrieval scenario first establishes the cached product and starts its
observation window. Its API request then checks:

```ts
const response = await clients.api.get('/products/product-1');
expect(response.status()).toBe(200);
expect(await response.json()).toMatchObject(product);
```

A cache-bypass implementation can pass those two assertions by reading
PostgreSQL and returning the same JSON. Keep the retrieval observation in the
scenario: the HTTP response alone does not establish the accepted cache-only
behavior.

## Connect the response to stored state and runtime behavior

The supplied scenario uses protected, sample-owned observation endpoints:

| Operation                              | Question it answers                                                                        |
| -------------------------------------- | ------------------------------------------------------------------------------------------ |
| `GET /fixture/products/product-1`      | Does PostgreSQL contain the product, and does Redis hold the expected cached product?      |
| `POST /fixture/observations/calibrate` | Can the observation mechanism detect a known cache miss and its application database read? |
| `POST /fixture/observations/start`     | Where does the bounded retrieval observation begin?                                        |
| `GET /fixture/observations/result`     | Which measured application/database and cache operations occurred during that window?      |

These endpoints are part of the product sample, not built-in Blackbox HTTP APIs.
The canonical suite supplies their request bodies and expected results in the
required order. In particular, the state inspection happens before the measured
retrieval, so its own Redis read cannot be confused with the application's read.

Use [PostgreSQL state](testing-postgres.md) to understand the committed-row claim
and [cache evidence](testing-redis.md) to interpret the retrieval observation.
For another application, ask the agent to find or prepare observations that
establish the same accepted claims.

## Follow the failed step back to the requirement

After preparation, run the native project from `e2e/product-cache/`:

```sh
pnpm --dir .. exec playwright test --config product-cache/playwright.config.ts --project native
```

If creation or retrieval returns a different status, compare the response with
the accepted operation before interpreting later state checks. If the status
matches but a required product field differs, the response clause failed. An
assertion that did not execute after a prior failure remains unchecked.

Return to [Read the evidence](verify-a-specification.md#read-the-evidence) for the
complete claim-by-claim result. Then follow
[Repair behavior from execution evidence](repair-from-evidence.md), where the
response remains correct while the implementation violates the cache requirement.
