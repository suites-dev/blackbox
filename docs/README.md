# Verify the behavior your system promises

Your specification says that creating a product stores it in PostgreSQL and puts
it in Redis. The next retrieval must use that cache without reading PostgreSQL.
An endpoint can return the right JSON while breaking this rule. Blackbox lets you
exercise the real system and check the evidence needed to tell the difference.

![An accepted product specification guides agent setup, executable expectations, a real PostgreSQL and Redis system, and its execution report.](assets/guides/product-cache-journey.svg)

## Follow the same rule through the whole journey

### Verify your first specification

Follow the product example from accepted behavior to a running system and its
execution report. See what establishes persistence, cache population, and a
retrieval without a database read.

[Start the walkthrough →](guides/verify-a-specification.md)

### Bring your own application

Give your agent the requirement. It discovers the system, prepares the Blackbox
configuration, and connects the clients and observations needed to verify it.

[Set up your application →](playwright/connect-your-application.md)

### Choose how to express the behavior

**[Native Playwright](playwright/README.md)** lets you write the expectations
directly in TypeScript with your project's SDKs.

**[Optional Gherkin Features](features/drafting-feature-files.md)** give your team
a shared place to review scenarios and generate their Playwright suite.

Both paths meet at the same Sandbox, system execution, and evidence review.

### Keep the rule verified as the code changes

Use a failed execution to guide the agent's repair, then rerun the same accepted
expectations. If you author Features, keep their generated suites aligned too.

[Repair from evidence →](guides/repair-from-evidence.md)

[Keep a Feature and its suite aligned →](features/generating-test-suites.md)

## Choose evidence for the claim

When a claim needs a closer look, follow the supporting guides for
[HTTP responses](guides/testing-http-apis.md),
[PostgreSQL state](guides/testing-postgres.md), and
[Redis behavior](guides/testing-redis.md). The
[polling guide](guides/testing-async-flows.md) explains how to wait for an
observable outcome when an accepted requirement allows eventual completion.

For exact syntax, use the [client and fixture reference](playwright/clients-and-fixtures.md)
or [Feature language reference](features/reference.md).
