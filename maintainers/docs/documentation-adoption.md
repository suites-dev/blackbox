# Adapting the earlier documentation bundle

The public docs were reviewed against the `Blackbox-Complete-Bundle` supplied through its `START-HERE.md`, then
rewritten for `agent/telemetry/capsule-telemetry` at base commit `1a938e42498b09207a578bbe4b435581982bdaee`.
This branch is being prepared for `release/v0.0.1-alpha`, the current default branch. The project is unpublished.
This is a source comparison and documentation decision record, not a new acceptance-run receipt.

The bundle explicitly combines a product story, proposed CLI, skills, and synthetic report designs. Its statement
that those commands are “available” is not implementation evidence. Current manifests, exported APIs, CLI handlers,
schemas, and the Bash acceptance journey determine what belongs in operational docs.

## Selection from the bundle

| Bundle material                                                  | Decision                                                                                                        | Current destination or reason                                                                                                                                   |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| README and verification-machine story                            | Retain the motivation; narrow present-tense claims.                                                             | [README](../../README.md): run a system, record actions, inspect runtime behavior. No available evaluator or Playwright claims.                                 |
| Capsule experiments                                              | Use Capsule as apparatus, experiment as procedure, and trial as one execution. Rewrite all commands.            | [Experiments](../../docs/experiments.md): explicit IDs, `exec`, drivers, `--purpose`, raw observations, stop.                                                   |
| CLI facade and CLI guide                                         | Replace with implemented command handlers.                                                                      | [CLI](../../docs/cli.md): no seven-command promise, curl/effects/checkpoint routes, positional IDs, or obsolete report flags.                                   |
| Getting started and configuration                                | Replace package installation and TypeScript config.                                                             | [Getting started](../../docs/getting-started.md) and [configuration](../../docs/configuration.md): source checkout, local tarballs, YAML, current fixture.      |
| Runtime evidence, instrumentation, query guidance                | Retain observation limits and targeted identity queries. Remove claims of implemented qualification/evaluation. | [Runtime evidence](../../docs/runtime-evidence.md): raw spans, actual activation, propagation and shared-state limits.                                          |
| Reports and retained artifacts                                   | Rewrite against current Capsule projection and viewer.                                                          | [Reports](../../docs/reports.md): live registry, static exports, actual paths, ownership, retention after stop.                                                 |
| Alpha status and CI                                              | Replace with current package and workflow facts.                                                                | [Status](../../docs/alpha-status.md), [packages](packages.md), and current workflow links.                                                                      |
| Playwright testing, effects/matchers, and snapshots              | Defer operational documentation.                                                                                | Playwright execution is next; assurance is a separate later layer. ODC, generated specs, and legacy contract promotion are excluded from the current direction. |
| Agent skill router, 29-skill installer story                     | Do not import over the repository's discovery skill.                                                            | [Existing skill README](../../agent-skills/README.md): one portable discovery entrypoint; CLI installation remains unimplemented.                               |
| SVG figures and interactive report designs                       | Reuse figures 07 and 11 as conceptual illustrations, with scope captions.                                       | Evidence qualification and instrumentation boundaries remain useful. Omit obsolete command/Playwright diagrams and HTML report fixtures.                        |
| Future contracts, approval, repair and developer-history designs | Keep outside current operational docs.                                                                          | No implied shipped workflow, promised date, or automated authority.                                                                                             |
| Archive, validation, and design handoff                          | Do not import as runtime proof.                                                                                 | Bundle checks validate that bundle; they do not validate this checkout.                                                                                         |

## Implementation anchors

- [Workspace manifest](../../package.json), [workspace definition](../../pnpm-workspace.yaml), and [package map](packages.md).
- [CLI handlers](../../packages/cli/src/commands/) and [not-implemented exit contract](../../packages/cli/src/contract/stub.ts).
- [Catalog schema](../../packages/catalog/schema/blackbox-config-v1.json) and [fixture catalog](../../e2e/blackbox.config.yaml).
- [Registry consumer preparation](../../scripts/consumer/prepare.mjs), [journey](../../demo/acceptance/capsule-test.sh), and [support/cleanup](../../demo/acceptance/capsule-test-support.sh).
- [Collector contract](../../packages/otel-collector/README.md), [Capsule report ownership](../../packages/capsule/README.md), and [viewer contract](../../packages/report-server/README.md).

## Keep the docs tied to implementation

Public guides address people cloning, building, and running Blackbox. Keep package architecture and validation in
the [maintainer package map](packages.md), and test harness details in the
[Capsule Bash acceptance guide](capsule-bash-e2e.md). The user quickstart walks through the built CLI directly;
the Bash journey is also offered as an optional guided demo.

When a backend lands, update its status, examples, and source links together. An advertised CLI route, historical
test file, or report mockup alone does not justify moving a capability into the available list. Keep proposed APIs
out of copy-and-run instructions until the documented branch can execute them.

For documentation changes, check Markdown formatting, local links/anchors, and command names/flags against source.
This workspace does not currently define the docs site's `docs:graph` or `docs:graph:check` scripts. Do not represent
those site-specific checks as passing here; validate this repository's local links directly. Runtime and CI results
must retain their own revision and execution evidence.

## Replace older examples

| Old bundle example                      | Current branch                                                                  |
| --------------------------------------- | ------------------------------------------------------------------------------- |
| `blackbox.config.ts`                    | `blackbox.config.yaml`                                                          |
| Positional system and Capsule IDs       | `--system <id>` and `--session <id>`                                            |
| `--intent`                              | `--description` on Capsule startup                                              |
| `--role diagnostic`                     | `--purpose inspection` on execution                                             |
| `capsule curl`                          | `capsule run --session <id> -- curl ...`, optionally with a catalog driver      |
| Positional participant on `capsule run` | Select `--via <name>`; its catalog declaration selects the execution location.  |
| `capsule effects`                       | No equivalent normalized-effects command. Use `observations` for raw telemetry. |
| `capsule checkpoint`                    | Not implemented.                                                                |
| `capsule report <id> --open`            | `capsule report serve --session <id> --open`                                    |
| `capsule report --json`                 | `capsule report export --session <id> --format json --output -`                 |

## Command storyboard as documentation source

The [Capsule command storyboard](../../demo/storyboard/capsule-demo.yaml), its
[catalog](../../e2e/blackbox.config.yaml), and project drivers ground the public
[subscription investigation](../../docs/experiments.md), [instrumentation guide](../../docs/instrumentation.md),
and [driver guide](../../docs/drivers.md). The reader-facing lessons are:

- Driver SDK installation and instrumentation installation prepare different sides of an interaction.
- Repeated instrumentation installation is idempotent.
- Static validation, runtime readiness, activation, and received observations are separate facts.
- The viewer can open before startup and remain useful after stop.
- Setup, stimulus, and inspection organize activities without changing their authority.
- An HTTP driver resolves an endpoint and injects context; a PostgreSQL driver chooses execution and connection settings.
- Queries narrow from an exact session to an activity and then a trace.
- Database output checks state separately from tracing the action that changed it.
- Exported reports are snapshots; the live viewer refreshes retained records.

Redis shared-state behavior comes from the extended Bash journey and its driver, not the YAML storyboard's main
HTTP/PostgreSQL sequence. Keep that distinction when updating examples. Public docs present these as product concepts
and workflows; alpha distribution and unavailable capabilities remain explicit in installation/status notes.

## Verification model and async feedback

The conceptual guides incorporate the execution-first evidence model from the supplied `gold.md` and the distinction
between apparatus, protocol, trial, evidence, and finding. Trace continuity strengthens association; it does not decide
whether an observation belongs to the execution's evidence. Completeness requirements depend on the claim.

[The verification machine](../../docs/verification-machine.md) cites the supplied Wei, Nguyen, and Böckeler articles
as background, and describes the Capsule's role in a development feedback loop. Flight control is an analogy, not a
new component. The current CLI supplies execution and observation; future evaluation is labeled separately.

The bundle's `docs/assets/figures/07-evidence-qualification.svg` and `11-instrumentation-boundaries.svg` are copied
unchanged into the public assets directory. Their captions distinguish conceptual qualification from an implemented
evaluator and other-process boundaries from available language installers. HTML reports were not imported.

[Async holes and Redis](../../docs/async-workflows.md) follows the actual Redis driver, consumer, and Bash evidence
checks: unchanged `RPUSH` arguments, `BLPOP`, a marked HTTP path, separate trace identities, and retained session scope.
The seeding example uses the fixture's real schema. The migration example is explicitly an application-owned mounted
file pattern, not a shipped fixture migration. System reduction uses existing `payment-mock` catalog entries.

## Follow-up alignment

The public [roadmap](../../docs/roadmap.md) links seven standalone issues for native Playwright, project skill
installation, assurance research, CLI vocabulary, public packages, publishing, and the HTML report. It does not
reintroduce the historical phase hierarchy or promise dates. The [agent skills guide](../../docs/agent-skills.md)
records platform research and manual installation; the CLI installer remains unavailable.

Portable references now label future Playwright and assurance guidance explicitly and use the current report commands.
The token assignment and escaped pipe in the subscription walkthrough were corrected. Release guidance reflects the
installed Lerna configuration while keeping publication separate from source availability.
