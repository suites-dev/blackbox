# Case study: verify persistence and cache-only retrieval

A product endpoint can return the right JSON while violating a rule about how it
uses PostgreSQL and Redis. This case study shows how to turn that rule into
reviewable checks.

**Availability:** the product application and fixture endpoints described here
are not included in this checkout. The `defineClient`, `clients`, and injected
`step` APIs used by related examples belong to a candidate revision outside this
branch. This is an implementation case study, not a runnable source-checkout
tutorial. Start with [the first system test](../getting-started.md) for a complete
example using available APIs. [Compatibility details](../alpha-status.md).

## Start with the accepted behavior

> Creating a product persists it in PostgreSQL and populates Redis. Retrieving it
> while its cached entry is valid returns the cached product without reading PostgreSQL.

Use one concrete product throughout:

```json
{ "id": "product-1", "name": "Field notebook", "priceCents": 1299 }
```

| Claim                                          | Required observation                                                                         |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------- |
| C1: Persist the product                        | The matching committed row, read independently after creation.                               |
| C2: Populate Redis                             | The expected cached value before retrieval.                                                  |
| C3: Serve a valid cache hit without PostgreSQL | Correct response and a bounded, calibrated observation of the retrieval's database activity. |

The accepted rule does not specify expiry, invalidation, or concurrent requests.
Those need separate requirements and scenarios. Internal class names are not
part of these claims.

## Review the executable expectations

| Scenario         | Arrange                                                        | Act                 | Assert                                                                            |
| ---------------- | -------------------------------------------------------------- | ------------------- | --------------------------------------------------------------------------------- |
| Creation         | Fresh system, product absent                                   | Create through HTTP | `201`, product response, independent PostgreSQL and Redis values                  |
| Cached retrieval | Calibrate observer, create product, verify cache, begin window | Retrieve once       | `200`, product response, no application database read during the completed window |

Each scenario must establish its own state. Retrieval cannot depend on the
creation test running first. A calibration request must happen before the
measured retrieval window.

![Creation stores the product; retrieval distinguishes a cache hit from a cache bypass.](../assets/guides/product-cache-evidence.svg)

<a id="run-the-supplied-example"></a>

## What an executable sample must supply

The product-cache application is not bundled with Blackbox. To make this case
study executable, an implementation must supply:

- The product API, Compose configuration, migrations, and cache contract.
- Independent state inspection and a scoped database/cache observer.
- Authentication and lifecycle for any fixture endpoints.
- Native tests, clients, runner configuration, and optional generated Feature suite.
- A demonstrated failure when the cache is bypassed and a passing rerun after repair.

The candidate compiler revision supplies APIs, not those application files.
Use [application setup](../playwright/connect-your-application.md) to implement the
boundary and [availability](../alpha-status.md) to choose compatible packages.

## Native Playwright

A project-owned native test can call independent PostgreSQL and Redis clients.
The [PostgreSQL](testing-postgres.md) and [Redis](testing-redis.md) guides contain
candidate client definitions. A project may instead expose authenticated test-only
inspection endpoints, provided they read real state.

For example, after a successful creation, a proposed inspection endpoint might
return:

```json
{
  "postgres": { "id": "product-1", "name": "Field notebook", "priceCents": 1299 },
  "redis": { "id": "product-1", "name": "Field notebook", "priceCents": 1299 }
}
```

Assert this against the expected product. The endpoint must not derive its answer
from the creation response. A recorded `INSERT` alone does not establish that
the row committed.

## Bound and calibrate the retrieval observation

The proposed observer uses PostgreSQL statement statistics filtered to the
application role and Redis command statistics during one isolated request.
Fixture reads use a different database role, and test-side Redis reads happen
outside the measured window.

A candidate fixture protocol is:

| Endpoint                               | Responsibility                                                                                 |
| -------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `POST /fixture/observations/calibrate` | Cause a known cache miss and demonstrate detection of the resulting application database read. |
| `POST /fixture/observations/start`     | Begin a measurement for the selected product.                                                  |
| `GET /fixture/observations/result`     | Return completed measurements and the selected identity.                                       |

These are proposed application endpoints, not Blackbox APIs. The implementation
must demonstrate counter reset/delta semantics, statistics visibility, completion,
and exclusion of unrelated traffic before a zero count is meaningful.

Expected design outcomes:

```text
Valid cache hit:     one retrieval, Redis read, no application PostgreSQL read
Deliberate bypass:   one retrieval, correct response, application PostgreSQL read
```

In a concurrent system, global counters may not isolate the request. Choose an
observer suited to that environment instead of copying this protocol unchanged.
[Absence evidence](../concepts/behavioral-evidence.md#why-absence-is-harder-than-presence).

## Optional Gherkin Feature

The [candidate Feature example](../features/drafting-feature-files.md) expresses
the same design through supported HTTP sentences. It requires actual fixture
endpoints and the candidate compiler. Registering a database SDK does not add
Gherkin database sentences.

## Read the evidence

Map the executed assertions back to C1, C2, and C3. Preserve product identity,
initial state, observed values, observation scope, and attempt identity. If an
assertion throws, later checks may not have run.

A valid response supports the response claim. Stored values support state claims.
A calibrated, completed observation supports the selected interaction claim
within its documented limits. None establishes every behavior of the system.

Once an implementation exists, introduce the [cache-bypass defect](repair-from-evidence.md)
and confirm the unchanged test detects it. [Reports](reports.md) explain which
attachments Blackbox supplies and which the project must create itself.
