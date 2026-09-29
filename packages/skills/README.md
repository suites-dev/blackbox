# Blackbox discovery skills

Prepare a reproducible local system or subsystem, select its behavioral boundary,
author its catalog, and validate a bounded Capsule experiment. The same bundle
supports first-time setup and reconciliation of an existing Blackbox project.

Start with [SKILL.md](SKILL.md). Keep this directory together when copying it to a
location your coding agent can read. Routing uses ordinary Markdown references;
there are no host-specific commands, installers, or hidden services.

## Contents

| Location | Purpose |
| --- | --- |
| `SKILL.md`, `skills/` | Public entrypoint and task-specific operational skills |
| `references/` | Contracts, analyzer recipes, boundary logic and command guidance |
| `schemas/` | Closed, versioned JSON contracts for audits, inspector results and receipts |
| `src/` | Readonly TypeScript models, contract checks, conservative boundary proposals and permission decisions |
| `examples/` | Illustrative HTTP, queue and blocked discovery records |
| `diagrams/` | Mermaid sources and a rendered-by-Markdown diagram index |
| `scripts/`, `tests/` | Local validation utilities and adversarial contract examples |

The skills and schemas are the operational contract. Reference algorithms propose
boundaries; they do not prove equivalence. Diagrams and examples explain the
contract. Analyzer recipes are instructions for existing tools, not bundled
language analyzers or acquisition adapters.

## Working with the bundle

For an existing project, ask the agent to read `SKILL.md` and state a behavior such
as: "Validate that consuming one job publishes a matching result to the output
queue, using only local dependencies." The agent must identify its current mode,
inspect before editing, and obtain any missing permissions before execution.

Root `blackbox.config.yaml` remains the application's configuration authority.
The discovery audit records reasoning and evidence separately. No discovery
artifact overrides the installed catalog schema or makes an unsupported runtime
available.

## Validate the contracts

From a Blackbox source checkout with its toolchain already prepared:

```sh
pnpm exec tsc --project packages/skills/tsconfig.json
node --test packages/skills/tests/*.test.mjs
node packages/skills/scripts/check-bundle.mjs
node packages/skills/scripts/validate-audit.mjs \
  packages/skills/examples/http/audit.json \
  packages/skills/examples/http/receipts.json
```

This directory intentionally has no separate workspace manifest or dependencies.
It uses the repository's compiler and Node runtime. Compilation writes only
`dist/`; the tests require no Docker daemon, credentials or network.

An accepted audit means its structure and references agree with the supplied
records. It does **not** authenticate those records, run the SUT, qualify an
assurance claim, or certify application correctness. Example receipts are marked
`example`; they must never be reported as real Capsule evidence.

See [the audit contract](references/audit-contract.md),
[capability resolution](references/capabilities.md), and
[the diagrams](diagrams/README.md).
