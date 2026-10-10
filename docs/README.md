# Verify the behavior your system promises

Your specification says that creating a product stores it in PostgreSQL and puts
it in Redis. The next retrieval must use that cache without reading PostgreSQL.
An endpoint can return the right JSON while breaking this rule. Blackbox lets you
exercise the real system and check the evidence needed to tell the difference.

![An accepted product specification guides agent setup, executable expectations, a real PostgreSQL and Redis system, and its execution report.](assets/guides/product-cache-journey.svg)

Start with **[Verify a specification against your system](guides/verify-a-specification.md)**.
Follow one accepted rule through agent setup, reviewed system tests, and a report
that shows what the execution established. The supplied product application keeps
the example small: one service, PostgreSQL, and Redis.

Then **[repair behavior from execution evidence](guides/repair-from-evidence.md)**.
Introduce a cache-bypass defect that still returns the correct response. Give its
failed verification to your coding agent, repair the implementation, and rerun the
same accepted expectations.

## Follow the same rule through the whole journey

| Your next task                                        | Where to go                                                        |
| ----------------------------------------------------- | ------------------------------------------------------------------ |
| Turn accepted behavior into a verified system test    | [The complete walkthrough](guides/verify-a-specification.md)       |
| Investigate a failure and repair the implementation   | [The repair chapter](guides/repair-from-evidence.md)               |
| Prepare your own repository with a coding agent       | [Connect your application](playwright/connect-your-application.md) |
| Express the expectations in TypeScript                | [Native Playwright](playwright/README.md)                          |
| Review a Gherkin Feature and generate its suite       | [Optional Feature authoring](features/drafting-feature-files.md)   |
| Keep the reviewed Feature and generated suite aligned | [Feature maintenance](features/generating-test-suites.md)          |

Native tests and optional Feature files are two ways to express expectations. They
meet at the same Blackbox Sandbox, Playwright execution, and evidence review.
Feature files are not required for specification-driven verification.

When a claim needs a closer look, follow the supporting guides for
[HTTP responses](guides/testing-http-apis.md),
[PostgreSQL state](guides/testing-postgres.md), and
[Redis behavior](guides/testing-redis.md). The
[polling guide](guides/testing-async-flows.md) explains how to wait for an
observable outcome when an accepted requirement allows eventual completion.

For exact syntax, use the [client and fixture reference](playwright/clients-and-fixtures.md)
or [Feature language reference](features/reference.md).
