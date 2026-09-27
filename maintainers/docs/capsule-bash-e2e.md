# Maintain the Capsule Bash acceptance journey

This guide is for contributors validating the Capsule implementation and package boundary.
For a first experience with Blackbox, use the [user quickstart](../../docs/getting-started.md).

## Prepare a checkout

Use the branch containing these docs. The repository's default branch is currently `release/v0.0.1-alpha`;
when reviewing a feature branch, run that branch to evaluate its implementation.

Prerequisites:

- Node.js 22.15 or newer in the Node 22 line and pnpm 9.15.4.
- Docker with Compose available and a reachable daemon (`docker info`).
- Bash, `jq`, and `curl` on the host. The fixture images provide the participant-side PostgreSQL and Redis clients.
- Network access for dependencies and container images on a fresh setup.

From the repository root:

```sh
pnpm install --frozen-lockfile
```

Keep the pnpm store backing this install available. Asset preparation reuses it when installing packed packages
into a temporary consumer outside the workspace.

> **The journey resets its fixture.** Use a disposable checkout, or preserve wanted `e2e/.blackbox/` evidence first.
> Preparation stops prior E2E Capsules and resets generated experiments, reports, temporary files, instrumentation,
> clients, and driver state. Run one journey at a time in a checkout.

## Run unattended or walk through interactively

For an unattended run:

```sh
pnpm test:e2e:capsule </dev/null
```

For a walkthrough in a terminal:

```sh
pnpm test:e2e:capsule
```

The terminal walkthrough opens the report viewer and waits for Enter between steps. Redirecting stdin disables those
pauses and browser opening; `CI=true` alone does not select unattended mode.

The root script runs [asset preparation](../../e2e/bash/capsule-assets.sh), then the
[Capsule journey](../../e2e/bash/capsule-test.sh). Preparation builds and packs all ten packages and installs the
tarballs into an external consumer. The journey uses that consumer's CLI and a project-local packed driver SDK,
so it checks the package boundary as well as runtime behavior.

## Follow the running system

The journey validates the [YAML catalog](../../e2e/blackbox.config.yaml), starts `subscription-system`, then:

1. Checks readiness and resets the fixture through its authenticated control endpoint.
2. Creates Alice's subscription using `curl` through the HTTP driver and checks the correlated trace.
3. Pushes a Redis stimulus and verifies the downstream fixture behavior while preserving the shared-state correlation gap.
4. Reads Alice's subscription through the PostgreSQL driver and checks the application fixture state.
5. Exercises a missing executable and checks that its failure is retained.
6. Reads the live report, exports snapshots, stops the Capsule, and reads the retained report again.

The telemetry proof checks the HTTP activity's parent relationship and participating services, plus the Redis
consumer's separate downstream HTTP trace. PostgreSQL command output and application fixture state are checked
separately. The journey does not assert complete capture of every PostgreSQL, Redis, or SQS operation.

## Read the result

The command prints the session ID and output paths. Success requires the final process exit to be zero, including
cleanup. The `Capsule journey passed` banner appears before the exit cleanup finishes.

| Location                                          | Contents                                                                                 |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `e2e/.blackbox/tmp/capsule-assets/`               | Package boundary checks and asset preparation receipt.                                   |
| `e2e/.blackbox/tmp/capsule-test.*/`               | Command outputs, telemetry proofs, report checks, cleanup evidence, and journey receipt. |
| `e2e/.blackbox/experiments/capsule-<session-id>/` | Retained session, activities, startup progress, sandbox and collector records.           |
| `e2e/.blackbox/reports/capsule-<session-id>/`     | Exported JSON and HTML snapshots.                                                        |

The journey cleans its temporary consumer and owned runtime resources. A subsequent run resets the fixture's
generated output, so preserve evidence you need before rerunning. Review telemetry and command output before sharing.

## Diagnose a failed run

| Symptom                                  | Next check                                                                                                                                 |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Missing dependency store or command      | Check the frozen install, pnpm store, and host prerequisites.                                                                              |
| Startup or readiness failure             | Inspect retained progress and sandbox records, Docker access, image builds, and fixture configuration.                                     |
| Expected spans do not arrive             | Inspect activation and collector status, then the exact session/activity/trace. Read [observation limits](../../docs/runtime-evidence.md). |
| Viewer port conflict                     | Check the owning viewer; the default is port `4310`. An unrelated listener is not stopped automatically.                                   |
| Banner appears but command exits nonzero | Read cleanup output and retained ownership records. The run has not passed.                                                                |

For package development, run `pnpm lint`, `pnpm typecheck`, and `pnpm test` separately. Package tests and helper tests
do not replace the Docker-backed journey. CI uses a separate [Capsule E2E workflow](../../.github/workflows/e2e.yml)
and retains its outputs even when the run fails. See [contributing](../../CONTRIBUTING.md) for the development workflow.
