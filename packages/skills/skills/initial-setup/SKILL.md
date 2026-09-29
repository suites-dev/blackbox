---
name: blackbox-initial-setup
description: Bootstrap Blackbox discovery in a project without an existing setup.
---

# Initial setup

Use only after the router finds no existing or partial setup. Read
[capabilities](../../references/capabilities.md) and
[inventory](../repository/SKILL.md).

## Procedure

1. Identify the repository root, source revision, requested behavior and permission
   scope. Inventory first. Do not run package scripts to discover what they do.
2. Identify the existing local harness, Compose files, Dockerfiles, migrations,
   fixtures and reset facilities. Preserve useful project conventions.
3. Resolve the installed CLI and catalog contract. If missing, return the exact
   prerequisite. Do not silently download a moving package or infer an installer.
4. Route through dependency, CI/IaC and I/O inspection. Ask for a specific missing
   repository only when evidence points to it and the user approves the scope.
5. Define accepted entry, terminal predicate, initial state and observation needs.
   An unspecified behavior permits inventory, not an invented success claim.
6. Propose a small boundary and the scoped catalog/driver/activation edits. Obtain
   permission to write before applying them. Follow [catalog](../catalog/SKILL.md).
7. Validate static setup before asking a Capsule to exercise the behavior. A live
   probe must include cleanup, even on failure.

## Return

Return an audit with `mode: initial`, the relevant task, source evidence,
selected or unselected boundary, and separate stage outcomes. Missing tools,
secrets, runtime support or approval are explicit blockers. Do not overwrite an
unexpected setup discovered during the operation; route to reconciliation.
