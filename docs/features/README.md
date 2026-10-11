# Why Blackbox uses Gherkin Features

When an agent generates implementation and tests, review **what it is checking**, not merely whether
the generated code compiles. A Feature makes selected examples of accepted behavior readable and
durable alongside the implementation.

Blackbox uses [Gherkin from Cucumber](https://cucumber.io/docs/gherkin/reference/) for
`Feature → Rule → Scenario` structure. The supported step library gives those sentences executable
meaning. Native Playwright remains first-class; Gherkin is not required for every test.

![The accepted specification, reviewed Feature and generated suite retain the same behavior.](../assets/readme/specification-triangle.svg)

## When to create the Feature

The agent drafts scenarios from the accepted requirement and asks the developer to approve their
meaning. Then it discovers or reuses the necessary system and investigates unknowns in a Capsule.
Concrete bindings can be refined later; changed preconditions or outcomes require renewed review.
The `feature file draft` route remains reserved but unavailable; the agent can author the file
normally. [Full workflow](../guides/from-spec-to-verification.md).

## Why a Feature helps coding agents

A small validated language is readable, provides precise feedback for unsupported sentences, and
keeps expectations visible beyond a transient prompt. Its durability comes from describing behavior
at the system boundary, not private classes or helper calls.

Gherkin alone is not a restricted execution language. Blackbox's supported vocabulary constrains what
can be compiled; richer native SDK operations remain available in directly authored tests.
[Unmesh Joshi on LLMs and DSLs](https://martinfowler.com/articles/llm-and-dsls.html).

The Feature is a **core review artifact when this path is used**, not the whole source specification.
In the planned contract layout, it sits beside executable assertions and an accepted effects
snapshot. The snapshot adds reviewed runtime expectations; it does not redefine the Feature after
a failing run. [One contract, related artifacts](../contracts/README.md).

## Follow a real requirement

The product rule requires persistence, cache population, and no PostgreSQL read on a valid cache hit.
This short excerpt checks only the creation response; the complete Feature covers the other checks.

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

[Complete Feature](drafting-feature-files.md#review-the-feature-rule-and-scenarios).

## Validate, generate, then execute

With PR #181's APIs and the product sample available, run from `e2e/product-cache/`:

```sh
pnpm exec blackbox feature file validate tests/product-cache.feature --clients tests/clients.ts
pnpm exec blackbox feature suite validate tests/product-cache.feature \
  --clients tests/clients.ts --output tests/product-cache.generated.spec.ts
pnpm --dir .. exec playwright test --config product-cache/playwright.config.ts --project feature
```

File validation checks supported compilation. Suite validation checks derived-file alignment.
Playwright executes the system. None of these commands captures or approves the proposed effects
snapshot. No new snapshot Gherkin sentence is defined here.

Generated output stays unedited. A future snapshot binding must be supported explicitly by the
compiler/runtime, not inserted by hand into generated tests. For project-owned TypeScript,
[editable scaffolds](../playwright/editable-scaffolds.md) describe a separate planned generator.

## What stays outside the Feature?

The source specification and human approval own intended behavior. Clients, startup configuration,
state readers and instrumentation are supporting machinery. An accepted effects baseline is a
separate expectation artifact, while raw execution records remain evidence.

The current HTTP vocabulary can call project-owned state/observation endpoints; registering another
SDK does not create new Gherkin semantics. Snapshot schema, scenario mapping and commands await the
implementation PR. State assertions remain in TypeScript or supported current steps; a `.state.yaml`
format is undecided.

[Feature reference](reference.md) · [Suite drift](generating-test-suites.md) ·
[Snapshot review](../contracts/reviewing-changes.md) · [Spec Kit](../integrations/spec-kit.md)
