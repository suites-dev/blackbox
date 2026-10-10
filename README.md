<p align="center">
  <img width="80" src="https://raw.githubusercontent.com/suites-dev/suites/master/logo.png" alt="Suites logo" />
</p>

<h1 align="center">Suites / Blackbox</h1>

**Spec-Driven Verification for agentic software engineering.**

Coding agents can write and rewrite implementations faster than we can inspect every detail. **How
do we know the running system still does what we intended?**

Blackbox helps an agent take **accepted behavior**, prepare the relevant real system, experiment
with it, and turn what it learns into **repeatable Playwright checks**. Developers approve the
expectations and inspect the reports. The implementation can change; the required behavior stays in
view.

[Start with a spec](#start-with-a-spec) ·
[Full developer workflow](docs/guides/from-spec-to-verification.md) ·
[Why this matters now](docs/concepts/why-verification-now.md)

## The developer workflow

<p align="center">
  <img width="900" src="docs/assets/readme/spec-to-verification-workflow.svg" alt="Developer supplies a spec, agent drafts a Feature for approval, discovers and rehearses the system in a Capsule, then produces either a deterministic generated suite or a proposed editable scaffold. Playwright executes a fresh Sandbox and reports the result." />
</p>

**Three stages.** First, agree on the expected behavior. Then let the agent discover and exercise
just enough of the real system to understand how to check it. Finally, keep that check so the next
implementation can be verified again.

Capsule is the **laboratory** for investigation. Playwright is the **repeatable verification**. They
use Blackbox's system infrastructure but run in separate environments.

The figure shows our **target workflow**, including planned capabilities. Existing commands and the
gaps are distinguished in the [step-by-step guide](docs/guides/from-spec-to-verification.md).

## Start with a spec

Bring a Markdown requirement, acceptance criteria, API contract, or a specification from an SDD
tool. Ask your coding agent:

```text
Use Suites Blackbox to verify this accepted specification.

Draft a Feature with reviewable scenarios and show it to me for approval.
Then discover the smallest real system needed to exercise the behavior.
Reuse existing Blackbox setup where possible. Explore unclear steps and
observations in a Capsule, and show me the Capsule report.

After investigation, create repeatable Playwright checks. Use the
deterministic Feature compiler when the vocabulary covers the behavior;
otherwise author project-owned TypeScript tests. Run the tests, show the
HTML report and what remains unverified, and repair the implementation
against the same approved expectations.
```

Blackbox has a CLI and [agent skills](docs/playwright/connect-your-application.md) for discovery,
Catalog setup, and Capsule investigation. With compatible packages installed:

```sh
pnpm exec blackbox skills list
pnpm exec blackbox skills install blackbox --codex
pnpm exec blackbox skills install discovery --codex
pnpm exec blackbox skills install catalog --codex
```

Use the relevant agent-host option instead of `--codex` where appropriate. Automated
`feature file draft` is **reserved but unavailable**, so an agent currently drafts the Feature as a
project file for review. The planned `npx @suites/blackbox-cli onboarding start` shortcut is **not
shipped**.

## One spec, more than one check

Suppose the accepted rule says:

> Creating a product persists it in PostgreSQL and populates Redis. Retrieving it while cached **must not read PostgreSQL**.

Both a correct implementation and a broken cache bypass can return the same HTTP response. The test
must also check **stored state and what the application did**.

<p align="center">
  <img width="790" src="docs/assets/guides/product-cache-evidence.svg" alt="Both implementations return the expected product, but the broken version performs a PostgreSQL read despite a valid cached value." />
</p>

This is why Blackbox can collect more than outputs: **state observations** and supported **runtime
effects** (including OpenTelemetry when instrumented). Each requirement determines which
observations are relevant. A missing SQL span alone doesn't prove a database operation never
happened.

[How evidence supports a check](docs/concepts/behavioral-evidence.md) ·
[Full product-cache example](docs/guides/verify-a-specification.md)

## Review the Feature, then prepare the system

A Feature makes the expected behavior understandable before an agent tests its own code. Gherkin
gives it a readable `Feature → Rule → Scenario` form; Blackbox's supported sentences provide a
constrained, validatable vocabulary.

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

**This excerpt checks only status.** The approved, complete Feature must also represent the database
and cache requirements. A developer reviews what the test means—not just whether it parses.
[Why Features work well with agents](docs/features/README.md).

Once those expectations are understood, the agent identifies the **verification boundary**: the
smallest real set of services and observations that can establish the behavior. For this rule that
includes the product service, PostgreSQL, Redis, and a reliable observation of database reads.

<p align="center">
  <img width="790" src="docs/assets/readme/system-boundary.svg" alt="Blackbox configuration selects the required real services, action and inspection drivers, and optional runtime instrumentation." />
</p>

Reuse an existing Catalog where possible. Otherwise configure it and check the selected setup:

```sh
pnpm exec blackbox catalog validate --json
```

Then, when useful, the agent **rehearses the scenario in a Capsule**: establishes state, performs
the action, inspects responses and operations, and shares the **Capsule HTML report**.

```sh
# Example: replace product-system with a real Catalog ID
pnpm exec blackbox capsule up product-system --json
pnpm exec blackbox capsule run --session <session-id> -- <command...>
pnpm exec blackbox capsule down <session-id>
pnpm exec blackbox capsule report serve --session <session-id> --open
```

Use the returned session ID, not a guessed value. **Capsule currently executes commands and
drivers—not Feature files directly.**
[Investigate with a Capsule](docs/guides/investigate-with-capsule.md).

## Two paths into repeatable Playwright tests

After the agent understands the system, choose how to preserve the check:

| Deterministic Feature compilation                                                                   | Editable Playwright scaffold                                                        |
| --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Supported Gherkin sentences become **generated native Playwright**                                  | Agent fills in **project-specific TypeScript and SDK assertions**                   |
| Regenerate and compare; **never hand-edit generated code**                                          | The authored file is editable and needs review against the accepted behavior        |
| Compiler is implemented in [PR #181](https://github.com/suites-dev/blackbox/pull/181), pending here | **Planned generator**, not a shipped CLI command; native authoring works without it |

The compiler needs the Feature, declared clients, and target system configuration. The editable path
is for cases that require richer interactions or observations than today's HTTP-only Feature
vocabulary.

**Both paths run through Playwright and Blackbox Sandboxes.** A scaffold is not a half-generated
Feature suite to patch. [How the two outputs differ](docs/playwright/editable-scaffolds.md) ·
[Feature compiler](docs/features/generating-test-suites.md).

## Run, inspect, repair, repeat

The final Playwright run starts a **fresh Sandbox** for each physical test attempt; it does not
reopen the Capsule. For the planned product-cache sample:

```sh
# From e2e/product-cache/ once the sample and PR #181 are available
pnpm --dir .. exec playwright test --config product-cache/playwright.config.ts --project native
pnpm --dir .. exec playwright show-report product-cache/playwright-report
```

The **Playwright HTML report** contains test steps, assertion outcomes, and Blackbox attempt
diagnostics. If a cache-bypass bug reads PostgreSQL, the agent can follow the failure, repair the
code, and rerun **without changing the approved expectations**.

<p align="center">
  <img width="790" src="docs/assets/readme/human-agent-verification-loop.svg" alt="The developer approves behavior; the agent implements, investigates execution results, repairs, and reruns the same expectations." />
</p>

A passing test supports **the behavior it actually checked in that execution**. It doesn't
mathematically prove every possible execution correct or show that every sentence in the original
spec was covered.

[Get started with the product-cache walkthrough](docs/guides/verify-a-specification.md) ·
[Repair from evidence](docs/guides/repair-from-evidence.md) · [Docs](docs/README.md)

---

## Alpha and further guides

**Candidate alpha:** Feature compilation and typed Playwright clients depend on
[PR #181](https://github.com/suites-dev/blackbox/pull/181); the referenced `e2e/product-cache/`
sample isn't published on this branch. Automated Feature drafting, Feature execution inside
Capsules, and editable-scaffold generation are **not shipped**. The documented workflow is our
intended experience, not a claimed successful end-to-end run from this checkout.

[Systems and Catalog](docs/playwright/connect-your-application.md) ·
[Capsule experiments](docs/guides/investigate-with-capsule.md) ·
[Feature vocabulary](docs/features/reference.md) · [Contributing](CONTRIBUTING.md) ·
[License](LICENSE)
