# From specification to repeatable verification

Start with **the behavior you want verified**. Blackbox's agent workflow follows that behavior into
the relevant real system, exercises its I/O interfaces, and preserves the accepted checks as
repeatable Playwright tests. The checks target the system's contract, so an agent can change its
internal code without redefining success.

![Developer approves behavioral expectations, the agent prepares the relevant system and optionally investigates it in a Capsule, then generated or authored Playwright checks run in a fresh Sandbox and produce an HTML report.](../assets/readme/spec-to-verification-workflow.svg)

This page describes the **target experience** and distinguishes what exists today from what is still
designed or pending. It is not a promise that one CLI command automates every stage in the current
alpha.

## 1. The developer brings the specification

Start with Markdown, an API contract, a ticket, or a reviewed SDD artifact. The agent derives
**candidate examples** of the intended behavior and makes them easy to review.

For the product-cache example:

> Creation persists the product in PostgreSQL and populates Redis. A valid-cache retrieval returns
> that product without reading PostgreSQL.

The developer approves the expected behavior _before_ the agent uses execution results to judge it.
An agent may suggest corrections; it must not redefine success based on what it observes.

Approval concerns the **meaning of the scenario**. The agent may later add concrete client names and
supported executable steps once the system is discovered. If those changes alter expected outcomes
or preconditions, return them for developer review.

A future CLI-assisted authoring step is reserved as
`blackbox feature file draft <spec> --output <feature>`, but **this command currently exits
unavailable**. Today the agent can draft the `.feature` file as a normal project file using the
[supported Gherkin vocabulary](../features/reference.md). A project can also choose
[native Playwright](../playwright/README.md) and skip Feature authoring.

## 2. Discover what must run

Once the intended behavior is clear, the agent inspects relevant entrypoints, services,
dependencies, state, and observation points. Source inspection helps it discover and repair the
implementation. The resulting test enters through the running application's I/O, rather than
importing an application class into the test process.

For the cache rule, the **verification boundary** includes the product API, PostgreSQL, Redis, and a
mechanism capable of detecting an application database read. The agent can reuse an existing Catalog
entry or prepare `blackbox.config.yaml` and its startup files.

Choose the smallest **sufficient** boundary. Run the real participants whose behavior the rule
constrains, and record anything external or substituted. Removing PostgreSQL would prevent the cache
example from detecting an unwanted database read. See
[system boundaries and expectations](../concepts/spec-driven-verification.md#why-the-testing-boundary-matters).

The current Catalog can be validated with:

```sh
pnpm exec blackbox catalog validate --json
```

[System setup](../playwright/connect-your-application.md) ·
[Catalog reference](../../packages/catalog/README.md)

## 3. Investigate uncertain behavior in a Capsule

A Capsule is the agent's **laboratory**: start the configured system, establish state, perform the
intended action through drivers or commands, inspect available observations, and revise the
experiment.

```sh
# Use an actual Catalog system ID. Capture sessionId from the JSON result.
pnpm exec blackbox capsule up product-system --json
pnpm exec blackbox capsule run --session <session-id> -- <command...>
pnpm exec blackbox capsule show <session-id>
pnpm exec blackbox capsule down <session-id>
pnpm exec blackbox capsule report serve --session <session-id> --open
```

The developer can inspect the **Capsule HTML report** to understand what the experiment observed,
which operations were correlated, and where the observation was incomplete.

**A Capsule does not currently run a `.feature` file as a test suite.** The agent rehearses the
proposed Given/When/Then behavior using supported actions and inspections. Even an apparently
successful experiment does not prove the spec itself is correct or that every later test will pass.

If the system is already known and its observations are trusted, this investigation can be brief or
skipped.

[Capsule investigation guide](investigate-with-capsule.md)

## 4. Preserve the behavior as executable checks

Both paths run as **native Playwright**, exercise the system through its interfaces, and keep the
accepted behavior visible in their assertions. They differ in how the test code is maintained.

### Compile a reviewed Feature

Use this path when every step fits the supported Gherkin vocabulary. The reviewed Feature, client
definitions, and Catalog produce a generated suite. **Never hand-edit that output**; suite
validation checks whether it still matches the Feature. The compiler is implemented in
[PR #181](https://github.com/suites-dev/blackbox/pull/181), which is merged but not included on this
docs branch.

For the generated path, the candidate compiler uses:

```sh
pnpm exec blackbox feature file validate tests/product-cache.feature --clients tests/clients.ts
pnpm exec blackbox feature suite emit tests/product-cache.feature \
  --clients tests/clients.ts --output tests/product-cache.generated.spec.ts
pnpm exec blackbox feature suite validate tests/product-cache.feature \
  --clients tests/clients.ts --output tests/product-cache.generated.spec.ts
```

### Author native Playwright

For custom SDK operations or observations outside the Feature vocabulary, the agent writes a
[project-owned native test](../playwright/README.md) using the required clients and observations.
Capsule findings can inform that setup when investigation was needed. Review the assertions against
the accepted behavior; this path has no compiler guarantee of alignment with a Feature.

A separate **editable-scaffold generator** is planned. Native authoring does not depend on it.

The two outputs must not be conflated: **an edited generated suite is no longer deterministically
derived from its Feature**. Learn more in [Editable scaffolds](../playwright/editable-scaffolds.md).

## 5. Run the final check and show the report

Playwright starts a **fresh Sandbox per physical test attempt**, connects clients, executes the
reviewed assertions, and produces a test report. It does not take over the earlier Capsule's live
environment.

```sh
# Example commands from e2e/product-cache/ once the sample lands
pnpm --dir .. exec playwright test --config product-cache/playwright.config.ts --project native
pnpm --dir .. exec playwright show-report product-cache/playwright-report
```

A different implementation can now be evaluated against **the same expected behavior**. The agent
repairs a failure and reruns without silently rewriting the specification.

Client bindings, startup configuration, state readers, and instrumentation may need repairs too.
Maintain that machinery while preserving the accepted expectations. If the expected behavior itself
needs to change, return to developer review.

[Product-cache verification walkthrough](verify-a-specification.md) ·
[Repair from evidence](repair-from-evidence.md)

---

**Alpha status:** this branch is documentation-only. The typed clients/Feature compiler from merged
PR #181 are not included here; the product-cache sample is not yet published here, CLI Feature
drafting is unavailable, direct Feature-in-Capsule execution is not implemented, and the editable
scaffold generator is proposed. Existing native Playwright tests and Capsule experiments remain
different execution paths.
