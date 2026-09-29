---
name: blackbox-discovery
description: Discover an application's local behavioral boundary, create or reconcile its Blackbox catalog, and validate setup with a bounded Capsule and a structured audit.
---

# Blackbox discovery router

Read [the operating contract](references/operating-contract.md) first. Work in the
user's application, not an assumed sample repository. A Capsule supplies the
apparatus; a procedure specifies setup, stimulus, terminal witnesses and checks.

## Choose the mode

| Observed state | Route |
| --- | --- |
| No catalog and no active Blackbox assets | [Initial setup](skills/initial-setup/SKILL.md) |
| Catalog, instrumentation, drivers, retained setup or a partial installation exists | [Reconcile](skills/reconcile/SKILL.md) |
| Existing setup fails | [Repair](skills/repair/SKILL.md), preserving the accepted behavior |

Do not infer that an absent executable means a fresh project. A catalog may exist
without the CLI. Do not infer that existing files are usable or current.

## Compose only the necessary skills

1. [Inventory repository evidence](skills/repository/SKILL.md).
2. Inspect [dependencies](skills/dependencies/SKILL.md), [CI/CD](skills/ci/SKILL.md),
   [infrastructure](skills/infrastructure/SKILL.md), and
   [I/O and environment](skills/io-environment/SKILL.md) as relevant.
3. [Select the behavioral boundary](skills/boundary/SKILL.md), then
   [author or reconcile the catalog](skills/catalog/SKILL.md).
4. [Run static preflight](skills/preflight/SKILL.md). If a live probe is authorized,
   [validate a Capsule](skills/capsule/SKILL.md), including
   [async completion](skills/async/SKILL.md) where necessary.
5. [Return the audit](skills/audit/SKILL.md), including when blocked or incomplete.

The output is [discovery-audit v1](schemas/discovery-audit.v1.json). Inspector
fragments use [inspector-result v1](schemas/inspector-result.v1.json). Preserve
source, inference, unresolved and runtime evidence as different variants.

Never expand repository access, execute discovered scripts, start resources, edit
CI, or access a remote service merely because a reference points there. Use the
[permission boundary](references/permissions.md). Each route returns explicit
gaps rather than inventing commands, fields or success.
