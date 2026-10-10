# From specification to repeatable verification

The developer's starting point is **a behavior they want checked**, not a container diagram.
Blackbox's intended agent workflow follows that behavior into the smallest useful running system,
explores it, and preserves the accepted checks as repeatable Playwright tests.

![Developer brings a spec, agent drafts and rehearses its behavior in Capsule, then verifies it using a deterministic Feature-generated suite or an editable Playwright scaffold.](../assets/readme/spec-to-verification-workflow.svg)

This page describes the **target experience** and distinguishes what exists today from what is still
designed or pending. It is not a promise that one CLI command automates every stage in the current
alpha.

## 1. The developer brings the specification

Start with Markdown, an API contract, a ticket, or a reviewed SDD artifact. The agent derives
**candidate examples** of the intended behavior and makes them easy to review.

For the product-cache example:

> Creation persists the product in PostgreSQL and populates Redis. A valid-cache retrieval returns that product without reading PostgreSQL.

The developer approves the expected behavior *before* the agent uses execution results to judge it.
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
dependencies, state, and observation points.

For the cache rule, the **verification boundary** includes the product API, PostgreSQL, Redis, and a
mechanism capable of detecting an application database read. The agent can reuse an existing Catalog
entry or prepare `blackbox.config.yaml` and its startup files.

Choose the smallest **sufficient** boundary, not the fewest containers. Replacing or excluding a
dependency can change the behavior being tested. **Blast radius** describes the potential impact of
a change; **verification boundary** describes what must run to answer this behavioral question.

The current Catalog can be validated with:

```sh
pnpm exec blackbox catalog validate --json
```

[System setup](../playwright/connect-your-application.md) ·
[Catalog reference](../../packages/catalog/README.md)

## 3. Rehearse inside a Capsule

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

## 4. Turn the rehearsal into executable checks

Both outputs eventually run as **native Playwright**. They differ in who owns the code and how
changes are checked.

|                          | Deterministic Feature suite                                                                                | Editable Playwright scaffold                                                     |
| ------------------------ | ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Good fit                 | Behavior expressed entirely in supported Gherkin steps                                                     | Custom SDK operations, project-specific setup, or effects outside the vocabulary |
| Starting point           | Reviewed `.feature`, client definitions and Catalog                                                        | Reviewed behavior plus Capsule findings                                          |
| Output                   | Compiler-generated `.spec.ts`; **never hand-edit it**                                                      | Project-owned `.spec.ts`; agent fills and maintains it                           |
| How alignment is checked | `blackbox feature suite validate` checks exact generation drift                                            | Review against the accepted spec/Feature; **no compiler drift guarantee**        |
| Alpha status             | Compiler implemented in [PR #181](https://github.com/suites-dev/blackbox/pull/181), not yet on this branch | **Planned** product capability; no shipped scaffold CLI command                  |

For the generated path, the candidate compiler uses:

```sh
pnpm exec blackbox feature file validate tests/product-cache.feature --clients tests/clients.ts
pnpm exec blackbox feature suite emit tests/product-cache.feature \
  --clients tests/clients.ts --output tests/product-cache.generated.spec.ts
pnpm exec blackbox feature suite validate tests/product-cache.feature \
  --clients tests/clients.ts --output tests/product-cache.generated.spec.ts
```

For the editable path, the agent writes a [native Playwright test](../playwright/README.md) using
the actual clients, fixtures, and observations established during Capsule investigation. The
separate **scaffold generator** is a design direction, not a command to try today.

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

[Product-cache verification walkthrough](verify-a-specification.md) ·
[Repair from evidence](repair-from-evidence.md)

---

**Alpha status:** this branch is documentation-only. The typed clients/Feature compiler depend on PR
#181, the product-cache sample is not yet published here, CLI Feature drafting is unavailable,
direct Feature-in-Capsule execution is not implemented, and the editable scaffold generator is
proposed. Existing native Playwright tests and Capsule experiments remain different execution paths.
