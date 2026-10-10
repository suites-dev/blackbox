# Why Blackbox uses Gherkin Features

When an agent generates both the implementation **and** the test, you need a way to review **what
it's checking**, not just whether the generated code compiles.

A Feature makes an accepted example easy to read. Blackbox uses
[Gherkin from Cucumber](https://cucumber.io/docs/gherkin/reference/) for its
`Feature → Rule → Scenario` structure and a **defined set of executable sentences** to make the
example testable. Features are **optional**—you can always write
[native Playwright](../playwright/README.md).

<p align="center">
  <img width="790" src="../assets/readme/specification-triangle.svg" alt="The accepted product specification stays connected to a reviewed Feature and its generated native Playwright suite." />
</p>

## When to create the Feature

In the [spec-first workflow](../guides/from-spec-to-verification.md), the coding agent **drafts a
Feature from the accepted requirement and asks the developer to review it before using it as a test
contract**. Only then does it discover the required running-system boundary and rehearse the
behavior in a Capsule.

The future `blackbox feature file draft <spec> --output <feature>` command is **registered but
currently unavailable**. Until an authoring provider is implemented, the agent writes the `.feature`
file normally and validates its supported sentences. Native Playwright remains another valid way to
express accepted expectations.

After Capsule investigation, a Feature can be compiled **deterministically** when every step is
supported. Richer tests can be written as native TypeScript; a separate
[editable scaffold generator](../playwright/editable-scaffolds.md) is planned, not a reason to edit
a generated Feature suite.

## Why a Feature helps coding agents

Free-form prose is great for discussing requirements but leaves a lot of room for interpretation. A
small, validated language gives the agent useful boundaries:

- **Readable:** a developer can inspect the expected behavior before a run.
- **Constrained:** Blackbox knows the supported request and assertion sentences. Unsupported steps
  fail validation instead of silently acquiring made-up behavior.
- **Actionable feedback:** a parser or compiler error can guide the agent to fix its scenario
  _before_ starting the system.
- **Durable:** expectations describe the running system's behavior, so an internal rewrite need not
  change the rule or its examples.

Durability comes from what the Feature specifies. The product rule constrains persistence, caching,
and retrieval through system interfaces; it need not name `ProductService` or a repository method.
Its Playwright checks exercise those interfaces against the running application. **That testing
boundary makes independence from the implementation practical.**

Client bindings, fixture endpoints, and observers may need maintenance. If the agreed interfaces and
behavior remain the same, maintaining them should preserve what counts as correct behavior. Gherkin
alone cannot prevent semantic drift: review the expectations, validate generated alignment, and
execute the tests.
[How these relationships differ](../concepts/spec-driven-verification.md#three-different-ways-things-drift).

Gherkin itself is a readable structure, **not a restricted execution language on its own**.
Blackbox's supported step library gives its sentences executable meaning. This is our application of
the constrained-DSL approach discussed in
[Unmesh Joshi's article on LLMs and DSLs](https://martinfowler.com/articles/llm-and-dsls.html).

## Follow a real requirement

The [product specification](../guides/verify-a-specification.md) says a new product must be saved in
PostgreSQL and Redis, and a valid cache hit must not read PostgreSQL.

A shortened scenario might be:

```gherkin
@system:product-system @sandbox:default
Feature: Product creation and retrieval
  Rule: Persist products and serve valid cache entries
    Scenario: Create a product
      When client "api" sends POST "/products" with JSON:
        """json
        { "id": "product-1", "name": "Field notebook", "priceCents": 1299 }
        """
      Then the response status is 201
```

**That only checks the response.** The [complete Feature](drafting-feature-files.md) also checks
saved state and cache-only retrieval. A green response doesn't establish that the rest of the rule
was satisfied.

## Validate, generate, then execute

With the APIs from merged [PR #181](https://github.com/suites-dev/blackbox/pull/181) and the product
sample available, the **candidate-alpha** path is:

```sh
# Run from e2e/product-cache/
pnpm exec blackbox feature file validate tests/product-cache.feature --clients tests/clients.ts
pnpm exec blackbox feature suite validate tests/product-cache.feature \
  --clients tests/clients.ts --output tests/product-cache.generated.spec.ts
pnpm --dir .. exec playwright test --config product-cache/playwright.config.ts --project feature
```

These are three different checks. **File validation** checks supported sentences. **Suite
validation** compares generated code to the reviewed Feature. **Playwright** actually runs the
system tests.

If the feature changes, update its generated suite deliberately; do not hand-edit generated
assertions to fit a failing implementation. See [suite drift](generating-test-suites.md).

## What stays outside the Feature?

The developer or existing SDD system owns the original business specification and its approval. A
Feature is a **reviewed set of executable examples**, not proof that every requirement was captured.
Blackbox does not automatically verify the adequacy of arbitrary prose.

The current compiler's [defined HTTP vocabulary](reference.md#sentence-reference) is intentionally
narrow. It can use project-owned inspection endpoints for database/cache checks, but adding a Redis
SDK does **not** create new Gherkin sentences. For richer interactions, use
[native Playwright and typed clients](../playwright/README.md).

A [Capsule experiment](../guides/investigate-with-capsule.md) may suggest a missing scenario. Have a
person review the expected behavior before recording it as an accepted check.

<p align="center">
  <img width="790" src="../assets/readme/capsule-to-feature.svg" alt="Capsule observations can suggest candidate expectations; human review accepts them before repeatable verification." />
</p>

[Write the complete product Feature](drafting-feature-files.md) ·
[Feature language reference](reference.md) · [Spec Kit handoff](../integrations/spec-kit.md)
