# From specification to a durable behavioral contract

Start with **one behavior you want verified**, not an infrastructure tour. Blackbox helps the agent
prepare the relevant real system and preserve the accepted expectations as repeatable checks.

![Review expected behavior, prepare the relevant system, investigate when useful, and verify through Playwright in a fresh Sandbox.](../assets/readme/spec-to-verification-workflow.svg)

This describes the target workflow. Effects snapshots extend the existing test path and are
**planned**, not implemented by this documentation PR.

## 1. The developer brings the specification

Use Markdown, an API contract, a ticket, or an SDD artifact. The agent proposes concrete scenarios;
the developer approves their meaning before judging the implementation against them.

For the product example: persist the product, populate Redis, and avoid PostgreSQL on a valid cache
hit. Later client bindings may be technical refinements. Changing expected outcomes or preconditions
needs renewed review.

A Feature is a durable, reviewable expression of selected expectations, not the entire source spec.
The `blackbox feature file draft <spec> --output <feature>` route is reserved but unavailable.
An agent can author the file directly or write native Playwright.

## 2. Discover what must run

Select the smallest **sufficient verification boundary**: entrypoints, real participants, state and
observation sources needed by the scenario. The test enters through I/O, not an imported business
class. Source inspection is still useful for the agent's discovery and repair work.

For cached retrieval, keep the API, PostgreSQL, Redis, and a credible database observer. Removing
PostgreSQL would prevent detecting a forbidden read. Record external or substituted dependencies.

Reuse existing `blackbox.config.yaml`, clients and startup files when they fit. A specification
selects the setup it needs; it does not require its own duplicate configuration stack. Fresh runtime
isolation is separate from reusable configuration.

```sh
pnpm exec blackbox catalog validate --json
```

[System setup](../playwright/connect-your-application.md).

## 3. Investigate uncertain behavior in a Capsule

The agent establishes state, acts through commands or drivers, inspects results, and shows the
Capsule HTML report. It can test whether the chosen boundary exposes the required behavior and
observations; that is not proof of equivalence with every production execution.

```sh
# Use a real Catalog ID and the sessionId returned by startup
pnpm exec blackbox capsule up product-system --json
pnpm exec blackbox capsule run --session <session-id> -- <command...>
pnpm exec blackbox capsule down <session-id>
pnpm exec blackbox capsule report serve --session <session-id> --open
```

Capsule does not currently run `.feature` files. It rehearses their intended actions through
supported tools. Known systems and checks can skip this investigation.
[Capsule guide](investigate-with-capsule.md).

## 4. Preserve the behavior as executable checks

A deterministic compiler generates complete native Playwright for supported Feature steps.
**Never hand-edit its output.** The merged PR #181 implements the compiler, but its code is not on
this docs branch.

```sh
pnpm exec blackbox feature file validate tests/product-cache.feature --clients tests/clients.ts
pnpm exec blackbox feature suite emit tests/product-cache.feature \
  --clients tests/clients.ts --output tests/product-cache.generated.spec.ts
pnpm exec blackbox feature suite validate tests/product-cache.feature \
  --clients tests/clients.ts --output tests/product-cache.generated.spec.ts
```

For richer interactions, the agent authors a project-owned native suite. A separate editable
scaffold generator is planned; native authoring already expresses that role without the generator.
Both paths preserve output and state assertions and can participate in the proposed snapshot model.
[Authoring contracts](../playwright/editable-scaffolds.md).

## Review candidate effects before accepting a baseline

With the planned snapshot capability, an execution can supply a candidate `.effects.yaml` beside
the test. First review the scenario's intended behavior; then review whether the candidate's
selected runtime interactions are appropriate to preserve. These are related but distinct decisions.

<picture>
  <source media="(max-width: 640px)" srcset="../assets/contracts/snapshot-review-mobile.svg" />
  <img src="../assets/contracts/snapshot-review.svg" width="900" alt="Capture produces a candidate; review accepts a baseline; a new execution is compared without automatically updating expectations." />
</picture>

Capture-by-default is being considered, **not automatic approval**. A Capsule may help identify
what to observe; the final test must reproduce its own state and evidence. Candidate promotion
between tools and exact snapshot association are not implemented or specified here.

The source spec, optional Feature, executable assertions, and accepted effects represent
[one behavioral contract](../contracts/README.md). State remains asserted in TypeScript while a
separate `.state.yaml` format is still under discussion.

## 5. Run the final check and show the report

Each physical Playwright attempt gets a fresh Sandbox. It does not take over the Capsule. In the
candidate sample, after installing its prerequisites:

```sh
# From e2e/product-cache/
pnpm --dir .. exec playwright test --config product-cache/playwright.config.ts --project native
pnpm --dir .. exec playwright show-report product-cache/playwright-report
```

Inspect the actual output and state assertions, available runtime observations, and attempt limits.
Snapshot comparison should add accepted-versus-observed effects, not replace those checks.
A difference leads to investigation or a proposed change for review—not automatic baseline updates.

[Reports](reports.md) · [Review changes](../contracts/reviewing-changes.md) · [CI](ci-verification.md)

Start with one behavior. Reuse the setup and observers for further scenarios. Existing Playwright
system tests are also an intended adoption path; there is no automatic migration flow promised here.

**Alpha scope:** the product sample is unpublished; the PR #181 APIs are not on this branch.
Automated drafting, Feature-in-Capsule execution, editable-scaffold generation and effects snapshot
comparison are planned. No state YAML or snapshot schema is finalized by this guide.
