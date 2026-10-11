# Blackbox documentation

Run your application in an isolated environment, act through its public interfaces,
and check the responses, state, and interactions your requirement calls for.

**Start here:** [Run your first system test](getting-started.md). It uses the native
Playwright API present in this checkout and includes every application and configuration file.

Blackbox is in alpha. [Availability](alpha-status.md) distinguishes this checkout's
APIs from candidate implementations and design proposals. Use documentation from
the same revision as your packages.

## Learn by running a test

- [Install Blackbox](installation.md): install the packages and prepare a test project.
- [Run your first system test](getting-started.md): start a service, assert its response,
  inspect the report, and see an assertion fail.
- [Understand the product-cache case study](guides/verify-a-specification.md): design
  checks for persistence, caching, and a forbidden database read. Its application
  and typed-client setup are not included in this checkout.

## Accomplish a task

| You want to…                                       | Read                                                         |
| -------------------------------------------------- | ------------------------------------------------------------ |
| Connect an existing application                    | [Configure a system](playwright/connect-your-application.md) |
| Write a native test                                | [Playwright authoring](playwright/README.md)                 |
| Set up a coding agent                              | [Start agent onboarding](agent-skills.md)                    |
| Investigate interactively                          | [Use a Capsule](guides/investigate-with-capsule.md)          |
| Diagnose a failed attempt                          | [Read reports](guides/reports.md)                            |
| Run the same tests in CI                           | [CI verification](guides/ci-verification.md)                 |
| Choose HTTP, database, cache, or completion checks | [Testing guides](guides/README.md)                           |

## Look up exact behavior

[Configuration](configuration.md) · [Playwright fixtures](playwright/fixtures.md) ·
[Drivers](drivers.md) · [Package and schema references](reference/README.md)

## Understand the model

[Specifications and tests](concepts/spec-driven-verification.md) ·
[Behavioral contracts](contracts/README.md) · [Choosing evidence](concepts/behavioral-evidence.md) ·
[Effects snapshots](contracts/effects-snapshots.md) · [Reviewing expectation changes](contracts/reviewing-changes.md) ·
[Verification with coding agents](concepts/why-verification-now.md)

## Explore candidate and proposed capabilities

[Feature compiler and typed clients](features/README.md) describe a candidate
implementation outside this branch. [Design proposals](design/README.md) cover
scaffold generation and a Spec Kit extension.

For help, see [Support](../SUPPORT.md). To improve these docs, see
[the documentation authoring guide](../maintainers/docs/documentation.md).
