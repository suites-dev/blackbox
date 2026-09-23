# Blackbox reset: Sandboxes, Testing, Assurance

Recorded on 2026-09-23 from Omer's product and implementation decisions in this conversation.

This document preserves the agreed direction before implementation. It is a handoff for rebuilding Blackbox around six workspace packages and three delivery phases. It does not claim that the proposed commands, recovery guarantees, or journeys already work.

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
| `packages/sandbox` | Phase 1 infrastructure core: explicit Compose input, execution admission, Testcontainers Compose acquisition, endpoints, resource ownership, lifecycle and recovery. It does not resolve a Blackbox catalog. The first slice has no OTEL or instrumentation behavior. |
| `packages/capsule` | Phase 1 interactive application layer: Capsule sessions and activities, host/container command execution, checkpoints, observational views and Capsule report inputs. |
| `packages/cli` | The CLI composition root: discovery installation, scaffolding, catalog commands, Capsule commands, observation queries and reports. It guides delivery without owning sandbox mechanics. |
| `packages/report-server` | Shared local report projection: provider registry, exact report/artifact selection, localhost HTTP serving, and the read-only registry viewer. It owns no Capsule or Playwright filesystem access; adapters are supplied by the CLI or later phase packages. |
| `packages/playwright` | Phase 2 native Playwright adapter: the preserved authoring facade, fixtures, attempt identities, scheduling/retry/shard integration and run finalization. |
| `packages/telemetry-analyzer` | Phase 3 effects normalization, qualification, matchers, baseline comparison/acceptance and assurance result production. It reads retained telemetry through explicit sandbox evidence interfaces. |

Keep dependency direction aligned with the phases: Catalog resolves product choices into explicit Compose inputs for Sandbox; CLI and Capsule compose Catalog and Sandbox; Playwright calls Sandbox with resolved inputs; Telemetry Analyzer reads retained telemetry/evidence contracts without becoming part of sandbox acquisition. Avoid circular dependencies and avoid copying the same lifecycle logic into adapters.

Public packaging remains an explicit later decision. The six workspace packages may eventually be published separately, bundled behind fewer public packages, or exposed through package subpaths. Do not freeze public names or install instructions while creating the internal skeleton, and do not preserve old public exports merely because archived packages had them.

Node activation and observation are later layers over the sandbox foundation, not part of its first implementation slice. Their eventual package/API placement remains a deliberate decision. The project owns its instrumentation bundle code, manifest, dependency lockfile and chosen dependencies. Blackbox does not ship application-library instrumentation as universal product behavior.

## Names and ownership

| Concept | Meaning |
| --- | --- |
| **Sandbox environment** | The acquired system, potentially spanning many containers, with activation, observation endpoints, readiness and owned resources. |
| **Capsule** | An interactive session owning a sandbox and a sequence of experiment activities. |
| **Participant** | An application service or dependency declared by the selected catalog/Compose topology, such as `public-api` or `postgres`. |
| **Activity** | An identified Capsule command or experiment operation with its own recorded outcome and observation association. |
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
  instrumentation/bundle/     # Runtime-native manifest, lockfile, bootstrap
  clients/                    # Optional future project-owned client helpers
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
- `capsule exec --participant <name> -- <command>` runs **inside that participant's container**.
- A future `--client postgres` helper may load project-owned connection logic from `.blackbox/clients/postgres.mjs`. It is a proposed convenience, not an implemented or required first-release feature.
- Supplying environment variables does not magically make an arbitrary client propagate trace context. The supported association/propagation contract for delegated activities must be explicit.

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
| 1 | `blackbox instrumentation bundle generate --runtime node` | Proposed spelling for generating a user-owned bundle shell. |
| 1 | `blackbox capsule start --system <name> --description <text>` | Start an interactive environment; environment/dotenv options are required capabilities whose grammar remains open. |
| 1 | `blackbox capsule list` / `status` / `wait` | Find sessions and inspect/wait for lifecycle state. |
| 1 | `blackbox capsule exec --session <id> -- <command>` | Run a local command with Capsule connection settings. |
| 1 | `blackbox capsule exec --session <id> --participant <name> -- <command>` | Run inside a participant container. |
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

Proposed simplification: use `capsule exec -- curl ...` instead of maintaining a separate curl-specific request engine. Generalize one-shot execution rather than retaining the current curl-only implementation. Final command compatibility/removal is still to be settled in the facade contract.

The optional `--client` helper, exact instrumentation command spelling, positional versus flag selectors, session-default rules for active commands, progress flags, JSON envelopes and exit classes remain open. Do not infer them from outdated CLI contracts. For host commands, define environment names and precedence, dotenv handling and collision behavior explicitly.

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
4. Exercise host commands and participant-container commands, query observations/effects, stop the environment and generate reports.
5. Pass exact session/activity IDs and artifact roots to small independent validators.
6. Verify retained results, report correspondence and resource cleanup; retain receipts, logs and failure diagnostics.

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
- The reset workspace defines six package boundaries: `catalog`, `sandbox`, `capsule`, `cli`, `playwright` and `telemetry-analyzer`. Implementation status differs by package and must be verified from the live tree rather than this snapshot.
- The previous package implementation was moved to the Git-ignored `archive/` directory for selective local reuse. It is not part of the workspace and must not become an implicit runtime/build dependency.
- Archived analyzer/report code still contains deleted ODC coupling. Reuse requires extracting accepted behavior rather than copying those packages whole.
- The old E2E consumer, gates, contracts and Gherkin example were deleted. Application source, catalog, Compose, instrumentation, Playwright configs/runner, subscription tests and baselines remain; a `.feature` file also remains.
- E2E selectors still point at `tests/systems/...` after tests moved to `tests/subscription-system/...`. The config references deleted global setup; the E2E manifest references deleted Gherkin and gates.
- No new Capsule Bash harness exists yet. Historical local runtime artifacts are not current acceptance evidence.
- Root scripts/workspace configuration still describe the old topology. The docs-graph scripts name a script file that is currently absent.

This snapshot explains the expected breakage. It is not an instruction to restore the removed components.

## Implementation order and remaining decisions

Start by preserving the intended source checkpoint and resolving the local-history/new-origin relationship. Reconcile the operating contract and Project #5 with the three phases. Create manifests and build/test boundaries for the six-package workspace skeleton and replace root wiring. Then implement Phase 1 in CLI-guided slices with the programmatic infrastructure suite and fresh Bash acceptance harness.

Phase 1 is complete when the installed Capsule journey, independent artifact checks and documented failure contract are demonstrated. Phase 2 builds on that shared engine. Phase 3 adds assurance to retained observations. Do not pull testing/assurance dependencies into Phase 1 to satisfy historical checks.

The following decisions are still open and must be resolved at their owning phase:

| Decision | Needed by |
| --- | --- |
| Publication/history strategy for the cleaned local tree and new private repository; disposition of historical Project items. | Before publishing implementation. |
| Public npm topology, package names, exports and install instructions over the six workspace packages. | Before the first packed external-consumer acceptance and publication. |
| Exact CLI grammar, selectors, environment precedence, discovery install destinations, scaffolding collision behavior, JSON streams and exit semantics. | Relevant Phase 1 command slice. |
| Whether to remove the dedicated curl command, final one-shot grammar, and whether named client helpers are in the first deliverable. | Capsule facade finalization. |
| Durable storage/journal format, admission boundary, supervisor arrangement, recovery ownership and resource reclamation. | Phase 1 failure guarantee. |
| Activity-to-observation association, trace propagation for arbitrary delegated commands, telemetry query schema and supported bounded capture windows. | Phase 1 observation contract. |
| Default retained fields/redaction policy, logs and attachments included; handling sensitive or removed fields. | Phase 1 retention/report contract. |
| Exact Phase 2 behavior for repeat-each, sharded aggregation and facade scheduling interactions. | Phase 2. |
| Occurrence/mapping compatibility, claim-relative closure, public result vocabulary and baseline compatibility/selection rules. | Phase 3. |
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
