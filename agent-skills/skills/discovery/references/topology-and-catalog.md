# Discover topology and author the catalog

Use this reference to turn a repository inspection into a reviewable Alpha catalog and a bounded first validation. Discovery is descriptive until a source or live probe establishes a fact.

## Start with the user's boundary

Identify the repository root, the requested behavior, and the system or smaller subsystem that can answer it. Read before executing project scripts or starting services. Inspect package and workspace manifests, lockfiles, Compose and deployment definitions, Dockerfiles, application entrypoints, client initialization, readiness declarations, existing tests, fixture/reset mechanisms, and telemetry wiring. Search bounded paths and skip generated output, dependency trees, caches, and retained run data unless they are directly relevant.

Read environment variable names and references without printing their values. Treat a Compose dependency, imported client, service URL, or a documented endpoint as a candidate edge. It does not prove that a request follows that edge at runtime. Mark each observation as source-backed, inferred, runtime-observed, or unresolved.

For each participant, record its stable project identity, role, runtime, startup/build source, declared readiness, state dependencies, candidate observation boundaries, and the files that support those facts. Include background workers, queues, scheduled work, subprocesses, and outbound services when they affect the requested behavior. Do not list every Compose service merely for completeness, and do not omit a required dependency just because it is external or inconvenient.

Propose a full-system boundary and, when useful, the smallest subsystem that answers the user's question. Explain included participants, local substitutes, omitted boundaries, state ownership, external endpoints, and unresolved product decisions. A queue-to-worker-to-database slice can be the relevant subsystem even if the user-facing request starts at an HTTP service.

## Keep one configuration authority

Create or update only root `blackbox.config.yaml`. It is the sole project-authored catalog and product-configuration source for systems, subsystems, participants, acquisition, readiness, isolation, observation, and activation. Do not revive `blackbox.config.ts`, hidden manifest scanning, Compose extension metadata, or another service graph.

Put tracked ordinary Compose files under `.blackbox/compose/`. Reference them from the catalog as an explicitly ordered list. Preserve useful existing Compose services and deployment conventions where possible. Compose files contain no Blackbox metadata or `x-blackbox` extension; Blackbox-specific topology and activation references belong in the catalog.

Track Alex-owned bootstraps under `.blackbox/instrumentation/` and accepted effects baselines under `.blackbox/baselines/`. Generated runs, reports, cache, and temporary files belong in their runtime-output locations and are not configuration authority. Do not commit generated evidence as a second catalog or planning system.

The catalog resolver produces one immutable, language-neutral plan used by both Capsule and native Playwright. Keep topology declarations and references independent of the current Compose implementation so other acquisition drivers can be added without changing the plan contract. Alpha's Compose/Testcontainers driver supports the product journeys; Dev Containers are the development and cloud-agent harness, not a second application acquisition path.

When migrating an existing setup, check real imports, public exports, package installation, and its actual Capsule or Playwright use before retiring a legacy file. The canonical YAML contract is authoritative, but a filename alone does not prove that an old path is unused; record the evidence for a removal in the requested migration.

Do not guess field names, defaults, or YAML schemas from a historical example. Follow the versioned public schema and examples exposed by the installed Alpha package and current product references. If the installation cannot resolve or validate the canonical YAML contract, report that blocker instead of creating a TypeScript config or a second source of truth.

## Separate stable topology from task expectations

Catalog facts should describe what the application contains and how Blackbox can acquire and observe it. They do not declare that behavior is correct. Keep acceptance expectations in the project’s tests or baseline flow as appropriate; a catalog change must not make a failed observation disappear by deleting its boundary.

For isolation, identify databases, queues, local files, and external services that can be shared between physical executions. Select a supported isolation profile based on the real state model. Reuse requires an explicit reset or namespace mechanism; a worker or container being reused does not make state fresh. Flag host Docker socket access, production credentials, production endpoints, and shared writable services for careful scope review.

## Validate in layers

Use the public machine-readable catalog commands where the local CLI implements them:

- `blackbox catalog validate` checks catalog validity without starting application services.
- `blackbox catalog list --json` inspects the available catalog entries.

Confirm the exact installed spelling and selected catalog IDs against public help or package docs first. A CLI registration or a successful parse is only static validation. It does not prove Compose acquisition, readiness, instrumentation startup, OTLP delivery, correlation, or application behavior.

When the task authorizes a live setup check, make it narrow: start the selected system, wait through the supported readiness path, perform one distinctive safe action, then inspect whether the intended participant produced a correlated observation. Keep health checks and fixture seeding separate from the product action. Use a local test endpoint and project-owned fixture data. Do not call paid or production services as an implicit part of onboarding.

Distinguish each result explicitly:

- **Catalog authored:** files and references were written.
- **Catalog validated:** the installed validator accepted the selected catalog.
- **Runtime exercised:** the selected environment started and the intended action ran.
- **Observation established:** the relevant correlated evidence was actually retained.
- **Setup complete:** only claim the stages the user requested and that the evidence supports.

A configuration diff, a Compose health response, or an empty effects list does not establish that all expected runtime operations are observable. For remaining gaps, link the missing participant, boundary, or capability and state which claim is still unanswerable.
