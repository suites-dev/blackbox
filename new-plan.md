# Blackbox reset: Sandboxes, Testing, Assurance

Recorded on 2026-09-23 and updated on 2026-09-25 from Omer's product and implementation decisions in this conversation.

This document preserves the agreed direction before and during implementation. It is a handoff for rebuilding Blackbox around explicit internal workspace boundaries and three delivery phases. It does not claim that every proposed command, recovery guarantee, or journey already works.

**The CLI facade guides delivery. Build the shared sandbox and Capsule journey first, add native Playwright second, and add assurance third.**

| Phase | Product outcome | Primary entrypoints |
| --- | --- | --- |
| **1. Sandboxes** | Discover, configure, activate, run, observe and stop a system through Capsules. Retain truthful records through failures. | Blackbox setup, catalog, instrumentation and Capsule commands. |
| **2. Testing** | Run existing native Playwright tests on the same sandbox engine, with isolated attempts and truthful execution records. | `npx playwright test`; CLI observation, history and reports. |
| **3. Assurance** | Evaluate what observations support, provide effects matchers and baseline comparisons, and report qualified results. | Playwright assertions; explicit baseline acceptance and CLI reports. |

## Decision status and planning authority

- **Agreed** means Omer explicitly selected the direction or confirmed it in this conversation.
- **Proposed** means a concrete recommendation discussed here whose exact interface or policy still needs agreement.
- **Open** means implementation must not silently choose a product contract.
- This file is explicitly requested by Omer. It records the reset; it is not a second issue backlog or a claim that historical Project items are current.
- Reconcile [Project #5](https://github.com/orgs/suites-dev/projects/5) and its owning issues with this direction before implementation is dispatched. Do not import the old backlog or merge old PRs wholesale.
- Current user decisions override historical contracts that prohibited scaffolding commands, required the old package topology, retained optional ODC, or prohibited every latest-session convenience.

## Repository reset and preservation

Omer renamed the former GitHub repository to **`suites-dev/blackbox-poc`** and created a new **private `suites-dev/blackbox`**. The POC must remain private permanently. No public visibility change is authorized by this plan.

The agreed local approach is to clean the current working tree: preserve the source needed for selective reuse, empty the old package layout, create the new skeleton, and copy selected implementation into it. Rebuild the E2E harness as well. Do not move the entire old dependency graph into the new folders and call that consolidation.

Preserve user edits, staged deletions and moves, worktrees, stashes, and useful source history. Do not restore deleted product concepts merely to make the old build pass. Do not run broad cleanup operations over unrelated user work or other people's Docker resources.

The GitHub rename happened after the initial same-repository decision. The remaining Git-history/publication choice is open: the local checkout still carries POC history, while its `origin` URL now names the new repository. Decide how the curated tree reaches the new private repository before publishing. Do not push the old history by accident.

## Product boundaries

### Keep

- One canonical root `blackbox.config.yaml`.
- Plain, tracked Docker Compose catalog files, without Blackbox metadata embedded in Compose.
- A shared programmatic sandbox engine used by Capsule and, later, Playwright.
- User-owned instrumentation bundles, with Node as the first and only implemented runtime initially.
- Generic OTLP intake, execution identities, correlation, raw observation access and retention.
- Effects normalization, then effects assertions and baselines in the appropriate phases.
- Capsule discovery and experiments; native Playwright authoring; JSON and HTML reports.
- Useful current implementation and tests when they directly serve these journeys.

### Remove

- `spec-playwright`, `spec-gherkin`, `spec`, `odc-node` and `odc`.
- All ODC behavior, adapters, public exports and product dependencies. ODC is removed from this reset, not kept as a hidden optional subsystem.
- Gherkin, generated specs, suite generation, catalog type generation and their command surfaces.
- Legacy proof-plan and contract-promotion product surfaces.
- Duplicate configuration authorities, obsolete package facades, old E2E orchestration and unsupported examples.
- Legacy imports, schemas, fixtures and documentation that keep the removed concepts alive indirectly.

Useful effects code currently contains ODC-named types. Extract the effects meaning and remove the coupling; deleting package directories alone is insufficient. Historical code and evidence can remain in the private POC. New code has no automatic compatibility obligation to every old export or artifact format. Preserve the agreed Playwright authoring facade.

## Workspace packages; public packaging later

The implementation has separate workspace packages. Their directory boundaries are decided now; npm publication names, which packages are public, and which packages users install are deliberately deferred.

| Workspace package | Responsibility |
| --- | --- |
| `packages/catalog` | Phase 1 configuration boundary: a language-neutral JSON Schema for `blackbox.config.yaml`, YAML loading and validation, semantic reference/path checks, deterministic listing/selection, and resolution into explicit Compose inputs for Sandbox. It does not start Docker. |
| `packages/sandbox` | Phase 1 infrastructure core: explicit Compose input, execution admission, Testcontainers Compose acquisition, endpoints, resource ownership, lifecycle and recovery. It does not resolve a Blackbox catalog. |
| `packages/driver` | Language-neutral driver protocol and Node authoring SDK. A project driver maps resolved resource data and a caller-supplied executable into argv, environment, propagation and redaction declarations. It does not implement business actions or own process execution. |
| `packages/telemetry` | Shared execution-scope mechanism: root-span lifecycle, W3C context propagation, child-process environment propagation, boundary-driver contracts and propagation outcomes. Capsule and Playwright consume it. It contains no product-specific business action. |
| `packages/instrumentation` | Language-agnostic instrumentation installation and provider contracts. It does not own OTLP transport or application-library instrumentation. |
| `packages/instrumentation-runtime-node` | Node SUT bootstrap: auto-instrumentation, incoming-context extraction, active-context management and outbound propagation. Other runtimes remain separate packages if introduced. |
| `packages/otel-collector` | Generic OTLP intake, durable retention and exact identity-based reads. It does not infer effects, claims or causality. |
| `packages/capsule` | Phase 1 interactive application layer: Capsule sessions and activities, subprocess ownership, checkpoints, observational views and Capsule report inputs. It consumes Sandbox and Telemetry. |
| `packages/cli` | The CLI composition root: discovery installation, scaffolding, catalog commands, Capsule commands, observation queries and reports. It guides delivery without owning sandbox or telemetry mechanics. |
| `packages/report-server` | Shared local report projection: provider registry, exact report/artifact selection, localhost HTTP serving, and the read-only registry viewer. It owns no Capsule or Playwright filesystem access; adapters are supplied by the CLI or later phase packages. |
| `packages/playwright` | Phase 2 native Playwright adapter: the preserved authoring facade, fixtures, physical-attempt execution scopes, browser/API boundary adapters, scheduling/retry/shard integration and run finalization. |
| `packages/telemetry-analyzer` | Phase 3 effects normalization, qualification, matchers, baseline comparison/acceptance and assurance result production. It reads retained telemetry through explicit sandbox evidence interfaces. |

`packages/client` is transitional and is replaced by `packages/driver` without a compatibility facade. Its authored business-callback model is not the target abstraction. Project-specific actions such as `create-subscription` do not belong in a shared product package.

Keep dependency direction aligned with the phases: Catalog resolves product choices into explicit Compose inputs for Sandbox; Telemetry supplies the shared execution/propagation mechanism; Capsule and Playwright compose Sandbox with Telemetry; runtime instrumentation extracts and propagates context inside the SUT; the Collector retains what it receives; Telemetry Analyzer reads retained evidence without becoming part of acquisition or transport. Avoid circular dependencies and avoid copying lifecycle logic into adapters.

Public packaging remains an explicit later decision. Workspace packages may eventually be published separately, bundled behind fewer public packages, or exposed through package subpaths. Do not freeze public names or install instructions while building the internal boundaries, and do not preserve old public exports merely because archived packages had them.

The project owns its instrumentation bundle code, manifest, dependency lockfile and chosen dependencies. Blackbox does not ship application-library instrumentation as universal product behavior.

## Names and ownership

| Concept | Meaning |
| --- | --- |
| **Sandbox environment** | The acquired system, potentially spanning many containers, with activation, observation endpoints, readiness and owned resources. |
| **Capsule** | An interactive session owning a sandbox and a sequence of experiment activities. |
| **Participant** | An application service or dependency declared by the selected catalog/Compose topology, such as `public-api` or `postgres`. |
| **Activity** | An identified Capsule command or experiment operation with its own recorded outcome and observation association. |
| **Execution scope** | The exact physical Capsule activity or Playwright attempt context that creates and owns a root telemetry context. |
| **Execution ownership** | Evidence that an observation occurred inside one isolated execution and capture interval. It does not by itself prove causal ancestry. |
| **Causal correlation** | Parent-child trace context, span links or explicit domain witnesses connecting a stimulus to processing. |
| **Test sandbox** | The sandbox belonging to one physical Playwright test attempt. |
| **Observer** | The component receiving, retaining and exposing telemetry with identities and visible capture limitations. |
| **Effects** | A versioned interpretation of raw observations. Raw telemetry remains available as source evidence. |
| **Assurance** | Qualification and evaluation of evidence against the test's actual expectations. |
| **Seal** | Finalization and integrity information about retained evidence. A seal alone does not prove observation completeness or application correctness. |

Use “sandbox” for the shared infrastructure primitive and “Capsule” for the interactive public journey. Avoid “system container” as the main name: a system may require several containers, and the term is easily confused with the Testcontainers library.

## Phase 1: Sandboxes

### Alex and Grisha's journey

1. Alex explores Blackbox and installs discovery using `blackbox skill install discovery`.
2. Grisha follows discovery, runs project setup, and retains the setup findings as an artifact.
3. Alex and Grisha author the root configuration and ordinary Compose catalog together.
4. The CLI creates the small runtime-specific instrumentation bundle shell. Grisha configures its code and dependencies for the actual application.
5. They validate and inspect the catalog.
6. Grisha starts a Capsule for the selected system, experiments through ordinary clients, reads observations, and records useful notes.
7. Stopping the environment preserves session records and allows JSON/HTML reporting afterward.

Target project-owned layout:

```text
blackbox.config.yaml
.blackbox/
  catalog/                    # Ordinary Docker Compose files
  instrumentation/            # Runtime-native manifest, lockfile, bootstrap
  drivers/                    # Project-owned resource-to-command adapters
  baselines/                  # Accepted effects baselines, introduced in Phase 3
```

Generated runs, reports, cache and temporary files are runtime outputs, not configuration authority. Keep them separate from tracked authoring inputs. Preserve existing user-owned files during initialization; exact collision/update behavior is an open CLI contract.

`setup init` initializes the project and records diagnostics. `catalog init` is the narrower catalog scaffolding operation. Discovery decides what the project needs; deterministic CLI mechanisms perform the requested operations.

### One shared sandbox engine

```text
Caller-supplied sandbox identity + ordered Compose files + environment
                              |
               Admit and durably record execution
                              |
            Acquire topology through Testcontainers
                              |
                    Verify readiness
                              |
                 Expose requested endpoints
                              |
                Record lifecycle transitions
                              |
                 Finalize records and release resources
```

Both Capsule and Playwright call this programmatic API. The API receives explicit Compose inputs and execution context; it does not depend on a catalog loader, CLI invocation or Playwright runner.

- Catalog selection and resolution happen before the sandbox call. Sandbox neither locates nor parses `blackbox.config.yaml`.
- The caller supplies the ordered Compose file list explicitly, with the working/project directory and environment needed to interpret it.
- Testcontainers' Docker Compose API consumes the ordered ordinary Compose inputs.
- Acquisition returns a `Sandbox` instance with read-only container views. Consumers can inspect container identity, host, mapped ports, caller-supplied environment and derived connection details, but cannot obtain lifecycle or mutation capabilities such as stop, restart, exec or file copy. Sandbox alone owns lifecycle mutation and returns immutable snapshots or getter-only facades rather than raw `StartedTestContainer` objects.
- The first sandbox slice has no OTEL collector, instrumentation bundle, runtime activation, effects or assurance.
- Later activation/observation work must arrive as explicit inputs or higher-layer composition without teaching Sandbox how to resolve a product catalog.
- Ports, containers, networks, volumes, processes, directories and leases have explicit ownership. Cleanup acts only on owned resources.
- Snapshotting or restoring sandbox state was mentioned as a possible future acquisition capability. It is not an agreed Phase 1 requirement.

### Users own the wire

The user's browser, `curl`, `psql`, SDK or application client owns requests, payloads, authentication and protocol behavior. Blackbox provides the environment, connection information, configured instrumentation and observation.

Do not introduce a mandatory proxy, traffic interception, request-rewriting layer, or replacement protocol implementation. Preserve delegated arguments, streams and exit status. Standard W3C propagation through supported, configured instrumentation remains part of the observation model; this is not a promise that instrumentation has zero overhead or cannot add trace context.

Agreed command execution behavior:

- `capsule exec -- <command>` runs on the **host**, with Capsule connection settings in its environment.
- `capsule exec --driver <name> -- <command>` selects a driver declared under the chosen catalog entry. The driver declares whether the supplied executable runs on the host or through Docker exec in a participant.
- There is no public raw `--participant` execution path. Participant execution is available only through a declared driver, so the catalog remains the authority for target and execution location.
- A driver receives resolved resource information and may adapt argv, environment, propagation and redaction declarations. It must preserve the supplied executable and must not turn a project business action into a shared Blackbox callback contract.
- Supplying environment variables does not magically make an arbitrary client propagate trace context. The supported association/propagation contract for delegated activities must be explicit.

The catalog keeps resource targeting separate from execution location. A driver target names the participant, protocol and port being addressed. Its required execution union is either `{ kind: 'host' }` or `{ kind: 'participant', participant: '<catalog participant>' }`. Host execution receives mapped host endpoints; participant execution receives Compose DNS names and internal ports. The driver itself runs as a short-lived host preparation process over versioned JSON stdin/stdout, then Capsule owns the prepared child process or Docker exec, streams it, records it and preserves its exit result.

Drivers may adapt any caller-supplied executable. They receive immutable resolved connection and telemetry context and return argv, environment, propagation outcome and sensitive-field declarations. They do not install `curl`, `psql`, language libraries or other protocol clients, and they cannot replace the supplied executable with a project business action. Missing executables become retained typed activity failures naming the attempted location and remediation.

Human terminal execution streams stdin, output, signals and terminal resize for both host and driver-selected participant execution. JSON and non-terminal modes preserve separate stdout/stderr and emit one final envelope. Interactive keystrokes are not retained. Retained output is bounded with explicit truncation metadata.

### Locked telemetry execution and propagation model

No collector or instrumentation bundle can force every operation into one distributed trace. The mechanism has four distinct parts:

```text
Activity or physical test attempt creates trace context
                         |
                         v
Boundary adapter injects context into a carrier
HTTP headers / message metadata / child environment
                         |
                         v
SUT runtime instrumentation extracts and activates context
                         |
                         v
Nested HTTP, Redis, SQL and messaging instrumentation
creates spans under the active context
```

Capsule and Playwright share one telemetry execution-scope abstraction. It creates the root span, owns its lifecycle and supplies W3C Trace Context to an explicit boundary adapter. OpenTelemetry active context and propagation carriers remain separate concepts; retaining OTLP data does not itself propagate context.

Supported adapter responsibilities are explicit and transport-specific:

- A Playwright browser adapter injects `traceparent` through request routing.
- A traced curl adapter adds a generated `traceparent` header.
- An AMQP adapter injects message creation context into message properties and preserves link semantics where appropriate.
- A runtime-process adapter injects `TRACEPARENT` and `TRACESTATE` into the child environment. The child bootstrap extracts and activates them.
- Redis or PostgreSQL shared-state writes report that generic causal propagation is unsupported. Arbitrary keys, values, rows or schemas must not be rewritten to smuggle trace context into an application.

Raw `capsule exec -- <command>` remains literal and does not silently become traced. A selected propagation driver may perform only its declared carrier adaptation. It preserves the supplied operation, delegated stdout, stderr and exit status, and records whether context was injected. It never implements a project business action.

Conceptually, every propagation attempt produces a discriminated outcome such as:

```ts
type PropagationOutcome =
  | {
      readonly kind: 'context-injected';
      readonly format: 'w3c-trace-context';
      readonly carrier:
        | 'http-headers'
        | 'message-properties'
        | 'process-environment';
    }
  | {
      readonly kind: 'context-not-supported';
      readonly boundary: 'shared-state';
      readonly resource: 'postgresql' | 'redis';
    };
```

Use `playwright-opentelemetry` as a design reference rather than adopting its lifecycle wholesale. Blackbox owns every physical-attempt identity, collector identity, retention and finalization, and must share the execution-scope mechanism with Capsule.

### Locked observation association and evidence boundary

Execution ownership and causal correlation are independent relationships:

- **Execution ownership** answers what happened inside one controlled, isolated sandbox execution.
- **Causal trace or link correlation** answers whether telemetry demonstrates a direct distributed execution path.
- **Session observation** records telemetry seen in a shared Capsule sandbox when it cannot be assigned honestly to one activity.

A connected trace strengthens evidence but is not the admission ticket for evidence. The physical Playwright attempt is the assurance boundary. Its fresh sandbox, exact execution identity and bounded capture interval make all retained sandbox telemetry candidate execution evidence, including separate traces emitted by pollers or background workers. Claim-specific qualification later decides whether that association is sufficient.

Capsule differs because several activities share one sandbox. Exact trace-associated telemetry may appear under an activity. Uncorrelated telemetry remains visible at session level, with temporal overlap represented only as temporal overlap. Capsule must not infer that one command caused it.

Setup and stimulus are semantic roles rather than protocol categories. A Redis write may seed prerequisite state or may itself be the entrypoint. Setup occurs before the claim evidence interval or is retained with setup purpose and excluded during qualification. A stimulus belongs to the execution observation scope even when its downstream effects occupy separate traces.

The locked assurance pipeline is therefore:

```text
Known initial sandbox state
  -> isolated physical attempt
  -> declared entrypoint
  -> complete execution observation scope
  -> versioned effects normalization
  -> claim-specific evidence qualification
  -> supported | refuted | insufficient evidence
```

Examples of required qualification:

- A returned HTTP response may use the direct process/response outcome.
- A worker eventually calling a payment service may use isolated-execution evidence when the sandbox excludes competing causes.
- A claim that one exact message caused one exact payment requires propagated context, a span link or a domain correlation witness.
- Absence, upper-bound and exact-count claims additionally require sufficient coverage, occurrence semantics and defensible closure.

One successful retry establishes one successful trajectory under its conditions. It does not establish reliability. Preserve every physical attempt; later success cannot erase or lend evidence to an earlier attempt.

### Activity logs and observation access

Lifecycle/activity logging is on by default, independently of verbose diagnostics. Retain structured records and display useful progress: selected system, startup stage, readiness, endpoints, instrumentation outcomes, command results and cleanup.

“HTTP and Redis loaded successfully” requires actual activation evidence. Configuration requesting those instrumentations is a different event. Observing their telemetry is a third event. Keep those distinctions in logs and reports.

Human lifecycle messages go to stderr when stdout carries JSON or delegated command output. A quiet option may suppress terminal progress without disabling retained records. Exact flags and the JSON/delegated-stream contract remain to be finalized. Do not dump secrets from environment or connection configuration into activity logs.

Instrumentation pushes OTLP into the observer. CLI/API callers query retained raw observations or normalized effects using exact execution/session/activity identities. Capsule observation and effects views report what was observed and what was unavailable; they do not evaluate behavioral claims.

The current implementation uses parts of the Playwright OTEL trace API internally. Reuse is allowed where it supports a generic observer without requiring the Phase 2 runner. Blackbox does not own or manage the upstream OTEL viewer. Users can install that viewer themselves.

### Capsule reports

Retain description/intent, activities, invocations, process outcomes, observations, capture limitations, attributed checkpoints and cleanup outcomes. Produce JSON and portable HTML without needing the stopped sandbox or a resident daemon.

Capsule reports have no assurance verdict, claim/proof model or baseline acceptance. Checkpoints are commentary, never machine-established conclusions.

Omer accepts a system-based convenience that chooses the latest session for reporting. Resolve the convenience to one concrete session ID and display it. Explicit `--session <id>` remains available; mutation and acceptance operations must not silently select an execution by recency.

## Phase 2: Testing

Preserve existing supported authoring through `test` and `expect` from `@suites/blackbox/test`, `test.sut(...)`, `test.system(...)` where used for declaration identity, normal `test()` and `test.describe()`, fixture extension and `definePwBlackboxConfig` composition. Keep `npx playwright test` as the execution entrypoint.

Playwright receives the proven sandbox API from Phase 1. Test authors do not construct Testcontainers environments, pass internal collector endpoints or reproduce activation plumbing in their tests.

| Scheduling/lifecycle feature | Agreed direction |
| --- | --- |
| Ordinary test | Fresh sandbox per physical attempt. |
| `test.describe()` | Grouping alone does not share application/database state. |
| Parallel tests | Independently owned resources, observations and attempts. |
| Serial tests | Preserve native ordering, skipping and retry semantics; each test attempt still gets fresh state. |
| Workers | A parallelism/capacity setting, not an authored sharing group. |
| Shards | Separate retained identities; aggregate results account for expected shards, including missing ones. |
| Retries | Retain every physical attempt. Later success cannot erase failure or lend evidence to another attempt. |

**Shared sandbox lifetimes are deferred.** This means test B does not inherit the application/database state left by test A, even when they run sequentially. Do not carry forward `per-worker` environment sharing as an active option. Unsupported sharing requests must not silently change behavior.

Playwright calls dependent group execution `serial`; it is not a new Blackbox `.sequence` API. Serial failure skips the remainder and group retries rerun the group. Ordinary sequential execution is different. Preserve native semantics rather than introducing a separate scheduler.

Current `test.system(...)` explicitly selects Playwright's `mode: 'default'`. Review that interaction with `fullyParallel` when preserving the facade. Decide repeat-each identity and support explicitly; the POC rejects repeated execution because its evidence keys cannot distinguish repetitions.

Use Playwright OTEL integration and standard W3C propagation under the hood. Browser propagation is supported only through the actual configured integration and application/origin constraints; do not assume every browser or arbitrary client is automatically correlated.

Playwright consumes the shared Telemetry execution scope. Its browser adapter injects context at the request boundary, while the attempt identity remains the broader evidence boundary. Browser trace continuity and exact attempt ownership must be retained as independent relationships.

Phase 2 adds attempt/run accounting, native outcomes, retries/skips/unstarted work, observation association, finalization and execution reports. Phase 3 adds assurance. Do not ship placeholder assertion behavior that appears to pass before its evaluator exists.

## Phase 3: Assurance

Use the retained observations from the first two phases as inputs:

```text
Raw OTEL observations
  -> versioned effects normalization
  -> scoped evidence qualification
  -> effects matchers and snapshot/baseline comparisons
  -> retained evaluation results
  -> faithful JSON/HTML assurance reports
```

Carry forward the useful principles in [POC PR #228](https://github.com/suites-dev/blackbox-poc/pull/228), not its obsolete product surfaces:

- Missing or unavailable observation cannot become an empty successful result.
- Instrumentation, normalization/mapping and expectation evaluation are different contracts.
- An operation span does not automatically prove committed application state.
- Absence, upper-bound and exact-count claims need sufficient observation coverage and closure for their scope. Silence, elapsed time or exporter flush alone is insufficient.
- Partial evidence can establish a positive witness or a counterexample where justified. Do not indiscriminately erase established violations because other evidence is incomplete.
- Preserve native process outcome, evidence validity, capture quality, qualification, evaluation and cleanup separately.
- Count distinct occurrences correctly; transport duplicates and separate identical-looking operations are different cases.
- Ordering uses supported witnesses and their assumptions, not array position or an unexplained comparison of independent clocks.
- Record the configuration, implementation, bundle, mapping, matcher, baseline and observation context needed to understand a result.
- Preserve every retry; do not combine attempts into a fictitious successful execution.
- Reports project validated retained results without strengthening unknown into success or mutating the evidence.

### Locked OSS assurance and authority boundary

The OSS edition contains the complete machinery required for an honest, evidence-linked runtime verdict. Correctness, run-integrity checks and truth semantics cannot be withheld to create product differentiation. Given the same claim, admissible evidence, execution context, evaluator version and policy, OSS and any extended edition must produce the same result.

The OSS promise is scoped:

> Blackbox evaluates declared runtime claims for an exact controlled execution and reports whether its retained evidence supports, refutes or is insufficient for those claims.

This is one runtime component of PR change assurance. It is not a universal certification that a PR is good, secure or authorized to merge. CI or a wider SDLC policy may combine the Blackbox result with builds, static analysis, security and other evidence.

The core distinguishes evaluation from authorization:

- Claim evaluation retains supported, refuted and insufficient-evidence results without changing them according to who reads the report.
- A strict OSS gate may pass only when the run is valid and every required Blackbox-qualified claim is supported; refutation fails and required insufficient evidence blocks.
- A human or organization may authorize a transition despite uncertainty, but that decision is recorded separately and never rewrites insufficient evidence as support.

The Blackbox-qualified claim vocabulary is deliberately closed and versioned. Open source does not make Blackbox responsible for arbitrary third-party assurance semantics. Every evaluator and result carries explicit authority:

- **Blackbox authority**: built-in claim types whose truth conditions, evidence requirements, closure rules, evaluator behavior and failure handling Blackbox defines and tests. These may contribute directly to the Blackbox verdict.
- **Organization authority**: a repository owner explicitly trusts a custom claim or evaluator under an identified policy. It may contribute to that organization's decision, visibly attributed to the organization rather than Blackbox.
- **Unqualified extension**: an extension may contribute observations, projections or candidate evaluations, but it cannot contribute to a Blackbox verdict. If a required claim depends on it, the strict result is blocked or insufficient rather than passed.

Extensions must expose claim identity and version, evaluator identity and authority, required and admitted evidence classes, closure requirements, result, diagnostic reason and deterministic artifact identity. A generic `evaluate(): boolean` extension point is forbidden because it would launder arbitrary code into a Blackbox-supported conclusion.

Product differentiation may add evidence sources, qualified claim types, stronger correlation and closure algorithms, organization policy, cross-run reliability analysis, managed history or operational automation. These capabilities may resolve more unknowns or cover more of the decision surface. They must not weaken the OSS truth model or convert missing/invalid evidence into success.

Machine-readable JSON and the low-cognitive-load local HTML report are both part of the OSS assurance surface. They project the same retained result. The human report exposes scope, claims, witnesses, counterexamples, evidence gaps and raw drill-down without inventing a stronger conclusion than the machine artifact.

Effects baselines are tracked, deliberate accepted expectations. Acceptance selects exact eligible retained run/attempt evidence, exposes the proposed change and records its provenance. Omer/the authorized owner controls acceptance. No agent may regenerate or accept a baseline to make tests pass, and Playwright snapshot-update flags must not bypass the acceptance policy.

An explicitly uninstrumented participant is different from failed required instrumentation. This declaration cannot excuse an observer required to answer a particular claim. A quiet PostgreSQL container is not automatically proof of zero database effects.

## CLI facade: guide for implementation

Define commands, inputs, outputs and failures before implementing the corresponding slice. The following is the discussed target surface, **not a claim of current support or a frozen grammar**. Existing implementations may be reused selectively.

| Phase | Command family / illustrative invocation | Purpose |
| --- | --- | --- |
| 1 | `blackbox skill install discovery` | Install discovery guidance. |
| 1 | `blackbox setup init` | Scaffold the project and retain setup diagnostics. |
| 1 | `blackbox catalog init` | Create catalog scaffolding. |
| 1 | `blackbox catalog validate` | Validate canonical config and referenced inputs. |
| 1 | `blackbox catalog list --json` | Inspect selectable systems. |
| 1 | `blackbox inst install --runtime node` | Idempotently prepare the user-owned runtime instrumentation bundle. |
| 1 | `blackbox driver install --runtime node` | Idempotently prepare project-owned drivers and install only the Blackbox driver SDK. |
| 1 | `blackbox capsule start --system <name> --description <text>` | Start an interactive environment; environment/dotenv options are required capabilities whose grammar remains open. |
| 1 | `blackbox capsule list` / `status` / `wait` | Find sessions and inspect/wait for lifecycle state. |
| 1 | `blackbox capsule exec --session <id> -- <command>` | Run a local command with Capsule connection settings. |
| 1 | `blackbox capsule exec --session <id> --driver <name> -- <command>` | Run through a declared driver; its catalog execution union chooses host or participant. |
| 1 | `blackbox capsule run --system <name> -- <command>` | Proposed generalization of the one-shot start/execute/stop convenience. |
| 1 | `blackbox capsule stop --session <id>` | Release owned resources and finalize records. |
| 1 | `blackbox capsule effects --session <id>` | Read normalized observations, optionally narrowed by activity. |
| 1, extended in 2 | `blackbox observations --session <id>` / `--run <id>` | Proposed shared raw-telemetry query family. |
| 1 | `blackbox capsule checkpoint` | Retain attributed experiment notes, without an assurance verdict. |
| 1 | `blackbox capsule report` | JSON/HTML session report; support exact session and system-based latest-session convenience. |
| 1, extended in 2 | `blackbox history` | Discover retained executions, including unfinished/interrupted records. |
| 2 | `npx playwright test` | Native Playwright execution. |
| 2, extended in 3 | `blackbox report --run <id>` | Execution report, later including assurance results. |
| 3 | `blackbox effects baseline update --run <id>` | Explicit acceptance of eligible retained baseline candidates. |

Use raw `capsule exec -- curl ...` for literal unadapted execution. A traced curl operation selects an explicit carrier-aware driver that adds W3C context and records the adaptation. Do not maintain an unrelated curl-specific request engine or silently alter raw commands.

The Phase 1 driver grammar is locked: raw commands execute on the host, `--driver <name>` selects a declared driver, and there is no public `--participant` or `--client` flag. Exact session IDs are required for execution. Driver location comes from the catalog and cannot be overridden at the CLI. `--purpose setup|stimulus|inspection` defaults to `stimulus`; `--allow-untraced` is the explicit override when promised propagation cannot be injected.

Automatic recognition of unfinished runs must not depend on users remembering a manual recovery command. Whether an explicit repair/recovery command is also useful is an open interface question.

## Failure guarantees: start in Phase 1

Omer's safety analogy is a **safety interlock**, supported by independent supervision and recovery. The bracelet's extra wire is secondary retention/redundancy. These are design principles, not claims about a particular phone's hardware implementation.

The proposed invariant is:

> Once Blackbox admits an execution, its existence is durably recorded. Failure to finish remains discoverable and cannot be interpreted as successful completion.

1. **Record before side effects.** Persist the execution identity and initial lifecycle record before acquiring resources or executing application commands. If admission cannot be recorded, refuse to start.
2. **Record incrementally.** Persist activity/attempt starts, resource ownership and completed stages. Do not depend on a final reporter to create the first record of execution.
3. **Supervise outside the worker.** Detect worker death/loss of progress without relying on that worker's catch/finally or signal handlers.
4. **Recover after supervisor failure.** A later reader/recovery pass finds unfinished records and determines whether an execution is still active, interrupted or unresolved. It must not seize live foreign resources.
5. **Finalize honestly.** Reconcile expected work with retained records. Preserve incomplete and invalid states; do not manufacture missing evidence or infer an exact failure cause from silence.

The journal and recovery path account for executions whose sealing code never runs. A completed seal is not a prerequisite for displaying an interrupted execution. Capsule uses the same durability mechanism without acquiring an assurance model.

### Required documented failure matrix

| Failure | Required observable behavior |
| --- | --- |
| Invalid catalog/bundle or acquisition failure after admission | Retain the attempted execution and the stage/reason; report no successful startup. |
| Missing or failed required instrumentation | Preserve activation/capture limitations; never represent this as successful empty observation. |
| Application process crashes during an activity | Retain what was observed and the process/activity outcome; mark affected observation limits. |
| Delegated command exits nonzero | Preserve its exit status and output; keep the session usable when its environment remains healthy. |
| Worker/client crash, unhandled failure or forced termination | Supervisor or later recovery accounts for the unfinished activity/attempt. |
| Collector fails or delivery is interrupted | Previously retained observations survive; missing capture remains visible. |
| Supervisor/manager is killed | Durable unfinished records remain discoverable without its finalizer. |
| Timeout, cancellation, Ctrl+C or ordinary termination | Attempt bounded finalization and cleanup; preserve the primary outcome and separate cleanup failures. |
| Storage becomes unwritable or a write is interrupted | Do not acknowledge unretained success; retain/recover earlier durable records and expose incomplete finalization where possible. |
| Finalizer/report generator fails | Raw records remain readable; report-generation failure cannot erase execution history. |
| Teardown fails | Identify remaining owned resources and preserve the original execution result. |
| Host restarts while retained storage survives | Recover admitted executions from durable records; do not assume callbacks ran. |
| Another execution uses the same machine | Isolate identity, ports, directories, leases and resources; never delete a foreign lease or clean up its resources. |

### Explicit limits

- No local process can print or finish a report while the host is powered off. Uncatchable termination cannot run a cleanup callback.
- The agreed first implementation does not guarantee survival of destroyed/corrupted storage or deletion of an entire ephemeral CI machine and its disk.
- CI uploads retained artifacts, but end-of-job upload does not guarantee preservation if the whole runner disappears first.
- Local restart recovery assumes the durable storage survives and implements the required persistence semantics. Atomic rename alone is not a complete power-loss durability specification.
- A crash can prevent retention of the last in-flight observations. Account for that limitation rather than promising zero telemetry loss.
- Define the exact admission boundary, write durability, supervisor ownership, liveness and recovery protocol before claiming these guarantees.

## Testing strategy

### Programmatic infrastructure integration

Build the substantial infrastructure suite outside the implementation package. Use installed package boundaries and full config/catalog/bundle inputs. Call the sandbox API directly, without the product CLI or Playwright adapter. A conventional test runner is allowed; “without testing” means without the Blackbox testing product layer.

Cover real filesystem, process, socket and container boundaries: normal startup, multiple participants, existing/missing instrumentation, before-import activation, readiness failure, application crashes, observer failure, concurrent ownership, cancellation, interrupted writes, supervisor death, restart reconciliation and bounded cleanup.

The failure matrix belongs primarily here, so it is not duplicated through every adapter. Keep focused semantic tests where appropriate. Prove resource ownership with actual independent inventory; filtering everything by labels before checking for leaks can hide unlabelled resources.

### Fresh Capsule-only Bash E2E

Omer explicitly selected a **Bash driver**. Replace the existing E2E harness; do not repair its old Playwright/ODC gates as Phase 1 work.

1. Pack the Phase 1 workspace packages and whichever installable facade the later public-packaging decision selects.
2. Install them into a fresh external consumer without workspace-only imports, ignored prerequisites or pre-existing build output.
3. Exercise discovery installation, setup, bundle preparation, catalog commands and real Capsule execution through the public facade.
4. Exercise raw host commands and participant execution selected through a driver, one carrier-aware propagated entrypoint, and one shared-state entrypoint whose downstream observations are not falsely presented as one causal trace.
5. Distinguish exact activity-correlated telemetry from unassociated session telemetry, query observations/effects, stop the environment and generate reports.
6. Pass exact session/activity IDs and artifact roots to small independent validators.
7. Verify retained results, report correspondence and resource cleanup; retain receipts, logs and failure diagnostics.

Use small Node/TypeScript validators where structured artifact checks warrant them; Bash remains the orchestration entrypoint. Missing evidence, a validator that never ran, a failed child command, or failed cleanup must not become a green harness result. Never merely record nullable seal fields without asserting the intended contract.

Reuse selected application fixture code if useful. Its current topology includes public API, fraud service, order service, payment mock, PostgreSQL, Redis and LocalStack. Reusing the application does not require reusing its old test harness, private reset assumptions or legacy schemas.

### Later acceptance

- Phase 2 adds small packed Playwright integration checks for fixture wiring, reporter lifecycle, attempts, retries, scheduling and shard accounting.
- Phase 3 adds independently specified effects/assurance cases, corruption and missing-evidence controls, baseline acceptance and report fidelity checks.
- The large sandbox suite does not prove that CLI arguments or Playwright reporter wiring are correct; retain focused adapter acceptance tests.
- Existing baselines or expected results must not be regenerated to fit implementation output.

## Repository inspection snapshot

Read-only inspection on 2026-09-23 found:

- Local checkout: `/Users/omer/projects/suites/blackbox`, branch `release/v0.0.1-alpha`, HEAD `58e2d28c69f51a135bc78daab3de795bf0a32e23`.
- `origin` is `https://github.com/suites-dev/blackbox.git`. That URL now names the new private repository, whose default branch is `main`.
- The private `blackbox-poc` repository defaults to `release/v0.0.1-alpha`.
- `AGENTS.md` is empty. User changes include substantial staged deletions/moves and unstaged edits; preserve them.
- At the time of this snapshot, the reset described six package boundaries. That topology is superseded by the current workspace table above, including the locked Telemetry, instrumentation and collector boundaries. Implementation status must be verified from the live tree rather than this historical snapshot.
- The previous package implementation was moved to the Git-ignored `archive/` directory for selective local reuse. It is not part of the workspace and must not become an implicit runtime/build dependency.
- Archived analyzer/report code still contains deleted ODC coupling. Reuse requires extracting accepted behavior rather than copying those packages whole.
- The old E2E consumer, gates, contracts and Gherkin example were deleted. Application source, catalog, Compose, instrumentation, Playwright configs/runner, subscription tests and baselines remain; a `.feature` file also remains.
- E2E selectors still point at `tests/systems/...` after tests moved to `tests/subscription-system/...`. The config references deleted global setup; the E2E manifest references deleted Gherkin and gates.
- No new Capsule Bash harness exists yet. Historical local runtime artifacts are not current acceptance evidence.
- Root scripts/workspace configuration still describe the old topology. The docs-graph scripts name a script file that is currently absent.

This snapshot explains the expected breakage. It is not an instruction to restore the removed components.

## Implementation checkpoint: 2026-09-25

The implemented Phase 1 slice now replaces the transitional Client callback model with the shared Driver and Telemetry boundaries. It is proven through a packed external consumer rather than workspace imports. The Capsule Bash journey currently demonstrates:

- catalog validation, instrumentation installation, Capsule acquisition and required activation before readiness;
- raw host commands and catalog-declared drivers that target either the host or one participant;
- exact participant connection environments captured in memory by Sandbox and supplied only to the selected driver;
- literal delegated argv, stdout, stderr and exit status, including missing-tool failures and remediation;
- W3C propagation for the HTTP entrypoint and a multi-service exact trace;
- an honest Redis shared-state entrypoint whose downstream work remains a session observation rather than being assigned falsely to the activity trace;
- bounded retained output, declared secret redaction, typed propagation outcomes and activity purposes;
- running and stopped JSON reports, static HTML export and one idempotent local report server;
- dead-manager reconciliation, interrupted activities, collector lifecycle failures and retained cleanup outcomes;
- cleanup checks for the exact containers, networks, volumes, images, processes and temporary assets owned by the journey.

Each package owns and exports the JSON Schema for its artifacts. The implemented driver installer is idempotent, preserves user-owned manifest content and dependency specifications, serializes concurrent installation, validates the installed SDK locally and does not accept a parent/workspace copy as proof of installation.

The current implementation has explicit limits:

- Host command execution does not yet allocate a real PTY. Resize requests report `host-pty-unavailable`; participant execution uses Docker's interactive stream.
- Instrumentation activation can append to inherited or Blackbox-supplied `NODE_OPTIONS`, but it cannot discover a value authored only inside an opaque Compose image or service environment before startup.
- Capsule is observational. Exact trace membership and session-only observations are displayed separately; Capsule does not issue assurance verdicts.
- Discovery, setup scaffolding, catalog initialization, Capsule list/status/wait/checkpoints, system-latest reporting and dotenv ergonomics remain incomplete or absent from the CLI facade.
- The Redis worker used by the acceptance journey is an E2E SUT fixture. It proves shared-state observation behavior and is not a product package or public driver.
- The current failure qualification is strong for process, persistence, collector, activation, reporting and recovery boundaries covered by automated tests. Host power loss, destroyed storage and full-machine disappearance remain outside the local guarantee described above.

## Implementation order and remaining decisions

The next Phase 1 work completes the missing CLI journey and the durable failure contract without widening Capsule into assurance. Phase 2 introduces Playwright only after the shared Sandbox, Driver, Telemetry and retention boundaries remain stable under that completed Capsule facade. Phase 3 introduces effects and assurance qualification over retained execution observations.

Phase 1 is complete when the installed Capsule journey, independent artifact checks and documented failure contract are demonstrated. Phase 2 builds on that shared engine. Phase 3 adds assurance to retained observations. Do not pull testing/assurance dependencies into Phase 1 to satisfy historical checks.

The following decisions are still open and must be resolved at their owning phase:

| Decision | Needed by |
| --- | --- |
| Publication/history strategy for the cleaned local tree and new private repository; disposition of historical Project items. | Before publishing implementation. |
| Public npm topology, package names, exports and install instructions over the internal workspace packages. | Before publication; internal packed-consumer checks may proceed without freezing the public topology. |
| Discovery install destinations and setup/catalog scaffolding collision behavior. Capsule driver selection, execution locations and activity-purpose grammar are locked above. | Relevant Phase 1 command slice. |
| Durable storage/journal format, admission boundary, supervisor arrangement, recovery ownership and resource reclamation. | Phase 1 failure guarantee. |
| Telemetry query schema, activity-purpose grammar and supported bounded capture windows. Execution ownership, causal correlation and session-level association are already locked. | Phase 1 observation contract. |
| Default retained fields/redaction policy, logs and attachments included; handling sensitive or removed fields. | Phase 1 retention/report contract. |
| Exact Phase 2 behavior for repeat-each, sharded aggregation and facade scheduling interactions. | Phase 2. |
| Occurrence/mapping compatibility, claim-relative closure, exact public result vocabulary and baseline compatibility/selection rules. The three-way epistemic result and authority separation are already locked. | Phase 3. |
| Late telemetry policy after finalization. Never silently rewrite an issued result; richer revisions/supersession are not committed scope. | Before making affected completeness/assurance claims. |

## Historical references for selective reuse

These references now belong to the private POC. They support the retained principles; current user decisions supersede their obsolete commands, packages and milestones.

- [Shared acquisition and client parity: #160](https://github.com/suites-dev/blackbox-poc/issues/160).
- [Native Playwright facade and journeys: #99](https://github.com/suites-dev/blackbox-poc/issues/99).
- [Evidence requirements and omission accounting: #163](https://github.com/suites-dev/blackbox-poc/issues/163).
- [Assurance boundaries: #97](https://github.com/suites-dev/blackbox-poc/issues/97), [unknown results: #205](https://github.com/suites-dev/blackbox-poc/issues/205), and [setup faults versus verdicts: #238](https://github.com/suites-dev/blackbox-poc/issues/238).
- [Explicit baseline acceptance: #202](https://github.com/suites-dev/blackbox-poc/issues/202) and [verification context: #204](https://github.com/suites-dev/blackbox-poc/issues/204).
- [Uninstrumented participants: #213](https://github.com/suites-dev/blackbox-poc/issues/213), [reports: #94](https://github.com/suites-dev/blackbox-poc/issues/94), and [late telemetry: #206](https://github.com/suites-dev/blackbox-poc/issues/206).
- [Prior Capsule command decisions: #233](https://github.com/suites-dev/blackbox-poc/issues/233).
- [Product and assurance doctrine: PR #228](https://github.com/suites-dev/blackbox-poc/pull/228).
