# Suites Blackbox

Blackbox helps a developer and coding agent exercise a real application, inspect what
happened behind its responses, and turn useful experiments into repeatable tests.
The two public journeys are **Capsule experiments** and **native Playwright tests**.
They share a catalog, acquisition, retained evidence, and deterministic assurance.

> **Target Alpha contract:** this README describes the agreed product being built.
> The complete journey is not yet demonstrated on the release branch. Read the
> [implementation snapshot](docs/alpha-product.md#implementation-snapshot) before
> treating a command or package as available.

## Start with the product reference

[Browse all topic guides](docs/README.md): onboarding, configuration, CLI, execution,
evidence, reports, CI, troubleshooting and supporting references.

- [Alpha product guide](docs/alpha-product.md): Alex and Grisha's journey, YAML catalog,
  instrumentation, CLI, evidence, reports and test boundaries.
- [Package responsibilities](docs/package-topology.md): all 20 existing package
  dispositions, the 11-package target and allowed dependency boundaries.
- [Agent operating contract](AGENTS.md): contribution, evidence and review rules.
- [Discovery skill source](agent-skills/skills/discovery/SKILL.md): portable onboarding
  guidance with supporting resources; copy its complete directory for host loading.
- [GitHub Project #5](https://github.com/orgs/suites-dev/projects/5): the sole authority
  for tasks, priorities, dependencies and delivery status.

## One setup, two journeys

Alex is the developer; Grisha is the assisting coding agent. The `discovery` skill
helps Grisha author one root `blackbox.config.yaml`, ordinary Compose files, and
Alex-owned instrumentation bootstraps.

```text
discovery → YAML catalog → immutable plan → shared acquisition
                                           ├─ Capsule experiment
                                           └─ native Playwright attempt
                                                    ↓
                              retained evidence → qualification → evaluation
                                                    ↓
                                    portable, read-only HTML report
```

Alex owns the OpenTelemetry SDK, application instrumentations and their dependencies.
Blackbox supplies activation/routing, generic OTLP intake, evidence retention,
qualification, deterministic evaluation and reports. A successful HTTP response
alone does not prove a downstream order was persisted; the claim needs appropriate,
correlated evidence.

Official Alpha adapter support is Node applications and JavaScript/TypeScript
Playwright. The catalog, execution and evidence contracts remain language-neutral.
ODC is optional Post-Alpha work and does not gate Alpha.

## Contribute against the current contract

Read the [product guide](docs/alpha-product.md) and the issue assigned through
[Project #5](https://github.com/orgs/suites-dev/projects/5). Use one issue per PR,
target `release/v0.0.1-alpha`, and open the draft PR before implementation.
Repository documentation explains the product; GitHub owns the work plan.

Documentation checks from a fresh checkout:

```bash
pnpm install --frozen-lockfile --ignore-scripts
pnpm docs:graph
pnpm docs:graph:check
```

These check documentation navigation, not product runtime behavior. Product tasks
must use their issue's validation commands and retain exact execution evidence.
For documentation changes, update the reference when a contract changes and keep
[source provenance](docs/source-provenance.json) separate from implementation proof.
