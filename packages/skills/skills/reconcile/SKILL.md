---
name: blackbox-reconcile
description: Inspect and reconcile an existing or partially configured Blackbox project without losing user edits.
---

# Reconcile existing setup

Read [catalog](../catalog/SKILL.md) and
[the operating contract](../../references/operating-contract.md).

## Procedure

1. Record current revision and content digests of the catalog, ordered Compose
   inputs, driver modules and activation assets. Preserve user changes and prior
   accepted expectations. Do not remove a file only because its name looks old.
2. Resolve installed capabilities. Compare the actual references against current
   source/build/startup facts. Classify differences as unchanged, additive,
   conflicting, missing, unsupported or stale in the audit's evidence and actions.
3. Reuse valid catalog entries. Inspect only changed paths and dependency closure
   where possible, but do not reuse a previous run as current runtime evidence.
4. Describe a reviewable edit plan. Recheck input digests immediately before
   writing; changed inputs invalidate the plan. Preserve ordered overrides and
   project-owned configuration instead of regenerating the entire catalog.
5. Do not "fix" a failed experiment by deleting its observation boundary,
   substituting away its worker, or changing its accepted predicate.
6. Rerun affected static checks. When authorized, run a fresh bounded Capsule with
   fresh data and exact identities, then report drift and unresolved conflicts.

## Return

Use `mode: reconcile`. A changed catalog or participant set invalidates earlier
setup receipts. Record old/new facts in evidence and limitations, but keep old
Capsule records intact. A denied edit or missing prerequisite yields a usable
incomplete audit, not destructive migration.
