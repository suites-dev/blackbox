# Establish cache population and cache-only retrieval

The [product specification](../../e2e/product-cache/specs/create-product.md) makes
two different promises about Redis: **C2: Cache population** makes the created
product available in the cache, and **C3: Cache retrieval** returns it without
reading PostgreSQL while that entry is valid. A populated key establishes the
first promise. The second needs evidence from the application's retrieval.

Use the [main walkthrough](verify-a-specification.md) for setup and the complete
scenario. Its [native suite](../../e2e/product-cache/tests/product-cache.native.spec.ts)
and optional Feature share the same sample-owned inspection and observation
operations.

## A cache hit is an absence claim too

A valid Redis value establishes **C2: cache population**, but not
**C3: no application PostgreSQL read during retrieval**. C3 needs
a bounded observer whose ability to detect SQL has been demonstrated
by a positive control. Missing SQL spans alone are not sufficient
without coverage guarantees.

The example's counters cover a single isolated retrieval and the
application PostgreSQL role. Preserve that scope when adapting it
to a system with concurrent or background traffic.

[Why absence evidence needs calibration](../concepts/behavioral-evidence.md#why-absence-is-harder-than-presence).

## Establish the cached product before retrieval

The [product service](../../e2e/product-cache/app/products.mjs) stores JSON under
`product:<id>` with a five-minute expiry. After
creating `product-1`, its protected `GET /fixture/products/product-1` operation
reads the database and cache. The scenario requires its `redis` value to equal
the expected product before exercising cache-hit retrieval.

That precondition matters: retrieving a product whose entry is absent would
exercise the miss path. A passing miss path cannot establish the accepted hit
behavior.

When your application needs a direct Redis observation, register a native client
and read the same key before starting the retrieval window.

## Connect a native client

Create a module exporting this definition and register it alongside `api` as
`{ clients: { api, cache } }` in the native Sandbox declaration:

```ts
import { createClient } from 'redis';
import { defineClient, expect } from '@suites/blackbox-playwright';

export const cache = defineClient(createClient, {
  target: { participant: 'redis', containerPort: 6379 },
  env: [] as const,
  create: (sdk, { endpoint }) => {
    const client = sdk({
      socket: {
        host: endpoint.host,
        port: endpoint.port,
        reconnectStrategy: false,
      },
    });
    client.on('error', (error) => console.error('Redis client error:', error.message));
    return client;
  },
  ready: async (client) => {
    await client.connect();
    expect(await client.ping()).toBe('PONG');
  },
  dispose: async (client) => {
    if (client.isOpen) await client.disconnect();
  },
});
```

Use `endpoint.host` and `endpoint.port`; the current endpoint's `url` is
HTTP-shaped. The sample Redis participant does not require authentication.
Configure credentials for an application that does. The source workspace
supplies the Redis SDK; an external project needs its own compatible dependency.

Blackbox readies the connection before the scenario and disposes it afterward.
`clients.cache` retains the SDK's methods and types.

## Read the stored value without confusing it with application behavior

After creation, a native scenario can observe the entry using its expected
`product` value:

```ts
const cached = await clients.cache.get(`product:${product.id}`);
expect(cached).not.toBeNull();
expect(JSON.parse(cached!)).toEqual(product);
```

This is a test-side Redis read. It establishes cache state, not which source the
application uses. Perform it before the measured retrieval, so it cannot inflate
the application's expected Redis read count.

The sample's five-minute lifetime is a fixture detail. If a later accepted
requirement specifies an expiry bound, a native assertion can read `pTTL(key)`:
positive milliseconds remain, `-1` means permanent, and `-2` means absent. Allow
elapsed time rather than expecting an exact `300000` reading. A positive remaining
TTL alone does not establish the original TTL or prove the eventual expiry.

## Observe the retrieval within a bounded window

The canonical scenario uses the sample's protected observation operations in
this order:

1. Calibrate the observer with a known cache miss that causes an application
   PostgreSQL read and a Redis read. This happens before creating the scenario's
   product.
2. Create the product and establish its persisted and cached values.
3. Start the observation window for `product-1`.
4. Issue exactly one application retrieval for that product.
5. Read the completed observation and compare it with the accepted outcome.

The expected cache-hit observation is:

```json
{
  "productId": "product-1",
  "applicationPostgresSelects": 0,
  "applicationPostgresStatements": 0,
  "applicationPostgresPlans": 0,
  "redisGets": 1,
  "retrievals": 1
}
```

The sample's [counter reader](../../e2e/product-cache/app/counters.mjs) uses
PostgreSQL statement statistics for the `product_app` role and
Redis command statistics within its isolated window. The database observer uses
a separate role. The positive control checks that a known read is detectable;
the zero counts then concern the subsequent, bounded retrieval. Planned-statement
counts add a guard for the sample's query path, including a query that is planned
but fails during execution. The
[observation window](../../e2e/product-cache/app/observations.mjs) is a project-owned
contract, not a built-in Blackbox absence assertion.

The window must contain only the selected application retrieval. Keep test-side
Redis reads and state-inspection requests outside it. Preserve the observer's
calibration, single-retrieval check, and application-role filtering when adapting
the example. Revisit the observation design if other traffic can enter that
window.

## Distinguish what the evidence establishes

| Observation                                                                                 | What it establishes                                                          |
| ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Expected product returned with `200`                                                        | The API returned the required product fields.                                |
| Expected JSON read directly from Redis                                                      | The product was present in the cache at that observation.                    |
| A Redis read during retrieval                                                               | Retrieval accessed Redis; this alone does not exclude a database read.       |
| Calibrated bounded observation with one Redis read and zero application database statements | The measured retrieval satisfied the sample's cache-only access requirement. |

Deleting the database row while keeping the cache can help distinguish returned
data sources. It still does not establish that no database read was attempted:
the application could read PostgreSQL, find nothing, then return Redis data. A
missing raw database span has a similar limitation if observation coverage is
unknown.

The [repair chapter](repair-from-evidence.md) introduces a cache-bypass defect
that returns the correct product while violating the database-read requirement.
Keep the accepted expectation fixed as the agent investigates and repairs it.

Return to [Read the evidence](verify-a-specification.md#read-the-evidence) with
both findings: whether creation populated the cache, and whether the measured
retrieval obeyed the cache-only rule. Use the
[Redis reference](../playwright/clients-and-fixtures.md#redis-state) for other data
shapes. Review expiry, invalidation, concurrency, and background updates as
additional requirements before adding their scenarios.
