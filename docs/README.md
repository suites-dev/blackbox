# Blackbox documentation

**Bring one accepted behavior. Keep its checks alongside the code. Verify it against the running system.**

Blackbox tests enter through I/O and check outputs, state, and required interactions. The planned
effects-snapshot workflow adds a reviewed runtime baseline to that same behavioral contract—not a
new source of truth independent of the specification.

<picture>
  <source media="(max-width: 640px)" srcset="assets/contracts/behavioral-contract-mobile.svg" />
  <img src="assets/contracts/behavioral-contract.svg" width="900" alt="The accepted specification informs a durable behavioral contract checked against fresh execution observations." />
</picture>

## Start with a useful verification

[Follow the developer workflow](guides/from-spec-to-verification.md): review scenarios, reuse or
prepare the relevant system, investigate in a Capsule when useful, and run repeatable Playwright
checks. With the planned snapshot capability, capture proposes a baseline; review accepts it.

The [product-cache walkthrough](guides/verify-a-specification.md) shows why a correct HTTP response
can hide an unwanted database read. It uses explicit observations today, not the proposed snapshots.

| Task | Start here |
| --- | --- |
| Understand the files and their authority | [Behavioral contract](contracts/README.md) |
| Understand capture, acceptance and comparison | [Effects snapshots — planned](contracts/effects-snapshots.md) |
| Integrate your repository with an agent | [System setup](playwright/connect-your-application.md) |
| Review Gherkin scenarios | [Features](features/README.md) |
| Write project-owned SDK assertions | [Native Playwright](playwright/README.md) |
| Explore a behavior | [Capsule experiments](guides/investigate-with-capsule.md) |
| Inspect and repair a difference | [Reports](guides/reports.md) · [Repair exercise](guides/repair-from-evidence.md) |
| Repeat accepted checks in CI | [CI verification](guides/ci-verification.md) |

## Go deeper when needed

[Why verification now](concepts/why-verification-now.md) ·
[Spec-Driven Verification](concepts/spec-driven-verification.md) ·
[Evidence](concepts/behavioral-evidence.md) · [Reviewing changes](contracts/reviewing-changes.md) ·
[Feature compiler](features/generating-test-suites.md) · [Feature syntax](features/reference.md) ·
[Clients and fixtures](playwright/clients-and-fixtures.md) · [HTTP](guides/testing-http-apis.md) ·
[PostgreSQL](guides/testing-postgres.md) · [Redis](guides/testing-redis.md) ·
[Async completion](guides/testing-async-flows.md) · [Spec Kit](integrations/spec-kit.md)

Start narrow and reuse what the agent established for later scenarios. Native tests remain
first-class; a new Feature is not required for every adopted behavior. The broader existing-test
adoption workflow is still being designed.

**Availability:** the product sample is unpublished and the APIs from merged PR #181 are not in
this docs branch. Snapshot commands, formats, comparison policy and default capture are planned;
a separate state YAML remains undecided. [Current workflow boundaries](guides/from-spec-to-verification.md).
