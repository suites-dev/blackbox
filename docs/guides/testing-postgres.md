# Establish that creation committed the product

Claim **C1: Persistence** in the
[accepted specification](../../e2e/product-cache/specs/create-product.md) says
that a successful creation stores the product in PostgreSQL. A `201` response or
an observed `INSERT` does not establish that the row committed. Read the expected
row through a separate connection after the application completes the operation.

The [main walkthrough](verify-a-specification.md) keeps this assertion with cache
population and retrieval under one specification. Its
[canonical suite](../../e2e/product-cache/tests/product-cache.native.spec.ts) uses
the sample's protected inspection operation. This guide explains that evidence
and shows how to make an equivalent observation with a native `pg` client.

## Read the state the application wrote

After creation, `GET /fixture/products/product-1` returns two independently read
values:

```json
{
  "postgres": { "id": "product-1", "name": "Field notebook", "priceCents": 1299 },
  "redis": { "id": "product-1", "name": "Field notebook", "priceCents": 1299 }
}
```

The `postgres` value is the stored row read by the sample's
[observation connection](../../e2e/product-cache/app/fixtures.mjs).
It is not a copy of the creation response. The scenario compares it with the
expected product; a missing or different row fails the persistence claim even if
the API returned `201`.

The `redis` value answers a separate claim. A passing PostgreSQL assertion cannot
stand in for [cache population](testing-redis.md), and neither stored value
establishes whether a subsequent retrieval reads PostgreSQL.

## Register the native pool

When adapting the scenario to direct database access, create a module exporting
this client definition and register it alongside `api` as
`{ clients: { api, db } }` in the Sandbox declaration:

```ts
import { Pool } from 'pg';
import { defineClient } from '@suites/blackbox-playwright';

export const db = defineClient(Pool, {
  target: { participant: 'postgres', containerPort: 5432 },
  env: ['POSTGRES_DB', 'OBSERVER_DATABASE_PASSWORD', 'OBSERVER_DATABASE_USER'] as const,
  create: (Client, { endpoint, env }) =>
    new Client({
      host: endpoint.host,
      port: endpoint.port,
      database: env.POSTGRES_DB,
      password: env.OBSERVER_DATABASE_PASSWORD,
      user: env.OBSERVER_DATABASE_USER,
    }),
  ready: async (client) => {
    await client.query('SELECT 1');
  },
  dispose: (client) => client.end(),
});
```

The source workspace supplies `pg` and its types. An external project must install
compatible SDK dependencies and supply the actual participant, credentials, and
schema. `clients.db` retains the native `Pool` API. `SELECT 1` establishes
connectivity; application migrations establish the schema.

Keep the test's observation connection distinct from the application's database
role. The product sample exposes the read-only `fixture_observer` credentials
through these `OBSERVER_DATABASE_*` environment values. It measures SQL performed
by `product_app`; test-side reads must not masquerade as application reads in that
measurement. Use a separately authorized writable client when a scenario needs
database seeding.

## Assert the committed row

The product table stores `id`, `name`, and `price_cents`. Add this assertion after
the API creation action in a native scenario, using its expected `product` value:

```ts
const stored = await clients.db.query(
  'SELECT id, name, price_cents AS "priceCents" FROM products WHERE id = $1',
  [product.id],
);
expect(stored.rows).toEqual([product]);
```

The parameterized query selects this scenario's product. The result assertion
checks one complete matching row and the selected field values. An unrelated row
cannot satisfy it. The application's connection performed the write; the test
connection observes its committed result.

For the cache-hit scenario, perform this state check while establishing the
precondition, before opening the retrieval observation window. The later claim
concerns application reads during one retrieval. Counting this deliberate test
read as part of that action would ask the wrong question.

For a multi-statement seed, use one connection for `BEGIN`, the seed statements,
and `COMMIT`; roll back on failure and release the connection in `finally`.
Commit setup before the application acts. Separate `pool.query` calls may use
different connections, and a test transaction cannot roll back work the
application committed. See the [database reference](../playwright/clients-and-fixtures.md#database-setup).

## Interpret a persistence failure

| Result                                         | What the agent should investigate                                  |
| ---------------------------------------------- | ------------------------------------------------------------------ |
| Creation did not return `201`                  | The operation failed before its promised result was established.   |
| Creation succeeded, but the query returns `[]` | The expected row was not visible on the observation connection.    |
| The row has different field values             | Compare the write with the accepted product data.                  |
| The pool fails before the scenario             | Resolve connection, credentials, readiness, or schema setup first. |

Each attempt owns its isolated PostgreSQL state. Client disposal closes the pool;
Sandbox teardown releases the environment. For an external shared database, an
adaptation needs explicit ownership and cleanup for every test write.

Return to [Read the evidence](verify-a-specification.md#read-the-evidence) with
the persistence finding, then inspect the separate
[cache-hit requirement](testing-redis.md). If a later accepted requirement makes
persistence asynchronous, add an [application-owned completion condition](testing-async-flows.md)
before reading its final state.
