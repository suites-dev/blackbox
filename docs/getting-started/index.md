# Getting started

Blackbox is designed to be configured and operated by your coding agent. You provide the behavior to investigate or verify and approve changes to expectations. The agent handles repository discovery, runtime setup, focused execution, and evidence inspection.

## Choose an entry point

For a repository that has not used Blackbox, start with [agent onboarding](agent-onboarding.md). For an already configured project, run a [first verification](first-verification.md) or open a [Capsule](../capsules/index.md).

A Markdown requirement is enough to begin the specification workflow. An existing Playwright test is also a valid starting point; a Feature file is not mandatory. Teams using Spec Kit can use the [integration guide](../integrations/spec-kit.md) without changing the downstream execution model.

## Prerequisites

The source toolchain requires Node **22.15 or later** and the repository-pinned pnpm **9.15.4**. Compose-backed execution requires an available Docker engine and Docker Compose. Static discovery and copying skills do not require a running application or Docker.

The agent also needs permission to inspect the repository and, separately, to install packages, pull/build images, start processes, create local resources, and contact any external service. Installing a skill grants none of those permissions.

## What setup should leave behind

The project should have a readable catalog, a documented system boundary, supported runtime observation where configured, and a focused check whose report identifies the execution. Cleanup must be checked independently from application behavior.

Continue: [Onboarding](agent-onboarding.md) · [Source installation](installation.md) · [First verification](first-verification.md).

## Source contract

[Implementation](https://github.com/suites-dev/blackbox/blob/9197de5de456285af16e4dcbcf722082217a3989/packages/blackbox/README.md).

## Pages in this section

- [Agent onboarding](agent-onboarding.md)
- [Installation and source preview](installation.md)
- [First verification](first-verification.md)

---

[Documentation](../README.md)
