# Follow a specification through verification

These guides follow **Spec-Driven Verification**:
accepted behavior → behavioral claims → executable expectations →
running-system evidence → implementation repair.

The specification is authoritative. Your coding agent can prepare the
system, author scenarios for review, and investigate failures, but
cannot silently redefine the accepted behavior to fit what it observed.

[Verification model](../concepts/spec-driven-verification.md) ·
[Evidence sufficiency](../concepts/behavioral-evidence.md).

Start with [Verify a specification against your system](verify-a-specification.md).
The supplied product application follows one accepted rule: creating a product
stores it in PostgreSQL and Redis; retrieving it while cached returns that
product without reading PostgreSQL. Continue with
[Repair behavior from execution evidence](repair-from-evidence.md) to use the
same expectations to catch and repair an implementation regression.

Native Playwright and optional Feature files are two ways to author the
expectations. They use the same configured system and return to the same
execution, evidence, and repair workflow. To start from your own repository, use
[Connect your application](../playwright/connect-your-application.md), then return
to [reviewing the executable expectations](verify-a-specification.md#review-the-executable-expectations).

## Choose evidence for the claim

Use these supporting guides when the walkthrough reaches the corresponding
question. They explain the evidence behind the same product rule.

| Question about the accepted requirement                                           | Supporting guide                                           |
| --------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Did the API return the specified product?                                         | [HTTP requests and responses](testing-http-apis.md)        |
| Did creation commit the product?                                                  | [PostgreSQL state](testing-postgres.md)                    |
| Was the product cached, and did retrieval use that cache without a database read? | [Redis state and cache-hit evidence](testing-redis.md)     |
| How do I express these expectations directly in TypeScript?                       | [Native Playwright authoring](../playwright/README.md)     |
| How do I review them as a Feature and generate a native suite?                    | [Feature authoring](../features/drafting-feature-files.md) |

After selecting the observation, return to the walkthrough's
[evidence checkpoint](verify-a-specification.md#read-the-evidence). A successful
response, a committed row, and an observed cache read answer different questions.

## Extend an accepted requirement

If a later requirement allows an outcome to become visible after the response,
review its completion condition and deadline before adding
[a bounded polling assertion](testing-async-flows.md). Keep the product rule
checked at creation time while it promises immediate persistence and caching.

For Feature users, [generated-suite maintenance](../features/generating-test-suites.md)
adds a drift check to the common local and CI verification workflow. Native tests
follow that same workflow without a generation step.

Use the [client and fixture reference](../playwright/clients-and-fixtures.md) or
[Feature language reference](../features/reference.md) for exact contracts.
