# Discovery

Discovery helps the coding agent understand how a repository becomes a running system. It is not a promise that every repository can be started automatically or that static topology proves behavior.

## Inspect before executing

Use the repository's own startup and test conventions: manifests, workspace structure, Compose files, Dockerfiles, CI configuration, environment documentation, entrypoints, readiness checks, and dependency configuration.

Separate observed facts from candidate interpretations. A reference to a database client indicates a possible dependency; it does not prove which live database a particular entrypoint will use.

## Produce a bounded plan

Record the proposed application participants, required dependencies, external boundaries, runtime support, ports, startup order, initial data, and the first question to test. Choose the smallest boundary that can still answer that question.

For unavailable secrets or external services, state the missing approval or alternative explicitly. Do not invent a dummy secret or replace a dependency while continuing to claim that the original system was exercised.

## Route work to the right capability

The Discovery skill can hand catalog authoring to the Catalog skill and live investigation to the Capsule skill. Missing packages contribute no skills. Static work can finish while live validation remains unavailable.

```sh
blackbox skills list --json
blackbox skills install discovery --codex
```

Installing the skill copies instructions; it does not run discovery automatically or install execution packages.

## Helper semantics

The package exposes helpers such as `validateAudit`, `validateInspectorResult`, `proposeBoundary`, `dependencyClosure`, and `authorize`. Structural validation checks schemas and receipt links, not authenticated runtime proof. Dependency closure conservatively retains prerequisites; it does not establish behavioral equivalence. Authorization helpers check caller-provided approvals and do not grant new authority.

## Validate the plan in execution

After static validation, start the selected entry, check readiness and required observation sources, run a focused behavior, and inspect cleanup. Feed failures back into configuration without silently weakening the original question.

Next: [Catalog](catalog.md) · [Boundaries](system-boundaries.md).

## Source contract

[Implementation](https://github.com/suites-dev/blackbox/blob/9197de5de456285af16e4dcbcf722082217a3989/packages/discovery/README.md).

---

[Documentation](../README.md)
