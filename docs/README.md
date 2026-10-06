# Blackbox documentation

Blackbox is a verification framework for people building software with coding agents. Its CLI and skills connect accepted behavior to system tests, isolated execution, and evidence from the running system.

Start with the [agent onboarding guide](getting-started/agent-onboarding.md). You do not need Spec Kit, a Gherkin suite, or knowledge of the package graph to investigate a system.

| Task | Start here |
| --- | --- |
| Set up a project | [Getting started](getting-started/index.md) |
| Turn requirements into executable checks | [Specifications](specifications/index.md) |
| Understand what a result establishes | [Verification and evidence](verification/index.md) |
| Investigate a failure | [Capsule experiments](capsules/experiments.md) |
| Keep checks repeatable | [Playwright](playwright/index.md) |
| Select or change the running boundary | [Systems](systems/index.md) |
| Operate through a coding agent | [Agent workflows](agents/index.md) |
| Connect an existing SDD workflow | [Integrations](integrations/index.md) |
| Look up commands and types | [Reference](reference/index.md) |

## Two execution paths

```text
Accepted behavior -> Playwright test -> fresh Sandbox -> evidence
Question          -> Capsule        -> experiments   -> evidence
```

An investigation can lead to a new test, but observed behavior does not authorize a new expectation. The requirement remains the source of intent.

## Reading these docs

Guides explain the workflow; references describe contracts. Code labeled **illustrative** is not a complete project. Complete example files live in [examples](examples/README.md).

This documentation spans the source preview and the agreed next interface. The [availability and command map](status.md) identifies the exact source revisions and distinguishes existing APIs, incoming PRs, and planned commands. A written guide does not mean a package has been published.

## Project

[Contributing](../CONTRIBUTING.md) · [Security](../SECURITY.md) · [License](../LICENSE)
