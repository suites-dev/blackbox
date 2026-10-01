---
name: blackbox-repository
description: Collect source-backed setup evidence and candidate participants without executing repository code.
---

# Repository inventory

Read [permissions](../../references/permissions.md). Return graph fragments using
[inspector-result](../../schemas/inspector-result.v1.json).

## Procedure

1. Inventory bounded, project-relative paths. Inspect repository instructions,
   README, workspace manifests/lockfiles, Makefile/Taskfile/justfile, build and
   start scripts, existing tests and test harnesses. Skip dependencies, build
   output, caches and retained traces unless explicitly needed.
2. Find catalog/assets, Dockerfiles, ordered Compose inputs, CI definitions,
   deployment/IaC files, migrations, seeds, reset helpers and health checks.
3. Identify process entrypoints and their built artifacts. Separate source
   modules, packages, runnable participants and resource instances.
4. Record each conclusion with repository, revision, path, locator and assertion.
   A filename, import or service URL is a candidate relationship, not runtime
   proof. Record contradictory sources without silently choosing one.
5. Record unresolved cross-repository references and route an approval request
   before searching or fetching. Read permission does not authorize execution.
6. Route code dependencies, CI/IaC and protocol/configuration facts to their
   specialized inspectors. These return evidence, not competing catalog files.

## Return

List participants, resources, candidate edges, startup prerequisites and unresolved
facts in the normalized fragment. Describe skipped or inaccessible locations in
unresolved evidence. Never turn incomplete search coverage into "no dependency".
