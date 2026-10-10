# Blackbox documentation

**Spec-Driven Verification for agentic software engineering.**

Blackbox connects **accepted specifications** to **executable behavioral checks** and evidence from running systems. The specification says what must hold; coding agents use Blackbox to investigate whether the implementation holds up, repair failures, and rerun the same expectations.

## Start with one accepted rule

The [product-cache walkthrough](guides/verify-a-specification.md) follows an actual business rule through system setup, native or optional Feature authoring, PostgreSQL and Redis state checks, a database-operation observation, and a deliberately introduced defect:

> Creating a product persists it and populates Redis. Retrieving a cached product must not read PostgreSQL.

Or [connect your own repository](playwright/connect-your-application.md). The complete runnable example depends on the pending [Feature/Playwright API](https://github.com/suites-dev/blackbox/pull/181) and `e2e/product-cache/` sample, so check prerequisites before executing its commands.

## Understand the model

- [Spec-Driven Verification](concepts/spec-driven-verification.md): accepted intent, behavioral claims, executable expectations, runtime conformance, and drift.
- [Behavioral evidence](concepts/behavioral-evidence.md): outcomes, state, runtime effects, completion, observer limits, and uncertainty.
- [Specification sources and SDD](integrations/README.md): Markdown, native Playwright, optional Features, and an existing workflow such as Spec Kit.

## Follow the workflow

| Task | Guide |
| --- | --- |
| Verify a product requirement end to end | [Verify a specification](guides/verify-a-specification.md) |
| Prepare a system in your repository | [Connect your application](playwright/connect-your-application.md) |
| Write native system tests | [Playwright](playwright/README.md) |
| Review a Gherkin Feature | [Feature authoring](features/drafting-feature-files.md) |
| Keep the emitted TypeScript aligned | [Suite drift](features/generating-test-suites.md) |
| Investigate a violation and repair | [Repair from evidence](guides/repair-from-evidence.md) |

## Choose evidence for the claim

[HTTP output](guides/testing-http-apis.md) · [PostgreSQL state](guides/testing-postgres.md) · [Redis and cache-only retrieval](guides/testing-redis.md) · [Asynchronous completion](guides/testing-async-flows.md)

Use the [client and fixture reference](playwright/clients-and-fixtures.md) or [Feature language reference](features/reference.md) for exact syntax. For interactive investigation, see [Capsules](../packages/capsule/README.md).

A sample-specific inspection endpoint is not a built-in Blackbox API. A green response alone does not establish all state and effect claims; a missing span does not establish absence.
