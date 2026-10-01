---
name: discovery
description: Inspect an application's behavioral boundary, reconcile existing Blackbox setup, and route catalog authoring or live validation to available package skills.
---

# Discovery

Start in the user's repository with [the operating contract](references/operating-contract.md)
and [package routing](references/package-routing.md). Inventory, boundary selection
and an honest audit work without any optional feature package.

Choose [initial setup](skills/initial-setup/SKILL.md) when no setup exists,
[reconcile](skills/reconcile/SKILL.md) for existing or partial assets, and
[repair](skills/repair/SKILL.md) for an observed failure. An absent executable
does not establish that the project has no catalog.

Alpha has one project-authored topology authority: root
`blackbox.config.yaml`, referencing ordered ordinary Compose files. The
application owns its instrumentation bootstrap under
`.blackbox/instrumentation/`. Native Playwright supplies per-attempt Sandbox,
telemetry, and effects-contract fixtures; effect projection and automated claim
qualification are still in development.

1. [Inventory repository evidence](skills/repository/SKILL.md).
2. Inspect [dependencies](skills/dependencies/SKILL.md), [CI](skills/ci/SKILL.md),
   [infrastructure](skills/infrastructure/SKILL.md), and
   [I/O and environment](skills/io-environment/SKILL.md) as relevant. For an
   asynchronous boundary, preserve the distinctions in
   [trace continuity](references/trace-continuity.md).
3. [Select the behavioral boundary](skills/boundary/SKILL.md). Delegate catalog
   authoring to the available `catalog` skill, preserving that boundary.
4. [Run static preflight](skills/preflight/SKILL.md). For authorized live work,
   delegate the accepted procedure to the available `capsule` skill. It owns
   acquisition, command execution, async completion, observation and cleanup.
5. [Return the audit](skills/audit/SKILL.md), including when incomplete or blocked.

Check the host's available skills before delegating. A package dependency, CLI
command, old installed directory or TypeScript registry name does not establish
that its skill is currently available. If Capsule was not selected, do not load
or invent its instructions or install it automatically. Finish static discovery
and mark requested live stages blocked by the missing `capsule` integration.
If the package is selected but its skill has not been installed for this host,
report that separately. Installation is an explicit user choice.

The [audit schema](schemas/discovery-audit.v1.json),
[inspector schema](schemas/inspector-result.v1.json), and
[receipt schema](schemas/receipt-bundle.v1.json) describe output contracts.
[Example audits](examples/blocked/audit.json) are illustrative data, not proof of
execution. This package does not authenticate receipts or implement a live
discovery runner. See [audit limitations](references/audit-contract.md).

[Playwright authoring](references/playwright-and-authoring.md) distinguishes the
available per-attempt fixtures from planned projection and evaluation.
[Effects baselines](references/effects-and-baselines.md) remain design guidance.
Confirm installed capabilities before treating any described API as available.
