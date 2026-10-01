# Maintain the Capsule Bash acceptance journey

This guide is for contributors validating the Capsule implementation and package boundary.
For a first experience with Blackbox, use the [user quickstart](../../docs/getting-started.md).

## Prepare a checkout

Use the branch containing these docs. The repository's default branch is currently `release/v0.0.1-alpha`;
when reviewing a feature branch, run that branch to evaluate its implementation.

Prerequisites:

- Node.js 22.15 or newer in the Node 22 line and pnpm 9.15.4.
- Docker with a reachable daemon (`docker info`). The daemon runs both the fixture's Compose stack and the
  disposable package registry.
- Bash, `jq`, and `curl` on the host. The fixture images provide the participant-side PostgreSQL and Redis clients.
- Network access for dependencies and container images on a fresh setup.

From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm build
```

The journey no longer builds or packs packages itself. It installs the ten public packages from a disposable
Verdaccio registry, the same way CI does, so build the workspace once before preparing the consumer.

Start the registry (the values below match [`.github/actions/registry`](../../.github/actions/registry/action.yml)):

```sh
storage="$(mktemp -d)"
docker run --detach \
  --name blackbox-test-registry \
  --user "$(id -u):$(id -g)" \
  --publish 127.0.0.1:4874:4873 \
  --volume "$(pwd)/.github/verdaccio/config.yaml:/verdaccio/conf/config.yaml:ro" \
  --volume "$storage:/verdaccio/storage" \
  verdaccio/verdaccio:6.10.3
```

The storage directory is where the published packages land. CI publishes into one exactly like it in the `build`
job and passes it to every other job as the build artifact, so the lanes publish nothing and all install the same
bytes. Locally the directory is yours to keep or discard; `--user` lets the container write it.

Publish the built packages to it:

```sh
tarballs="$(mktemp -d)"
pnpm --recursive --filter './packages/*' exec pnpm pack --pack-destination "$tarballs"
for tarball in "$tarballs"/*.tgz; do
  env "npm_config_//127.0.0.1:4874/:_authToken=blackbox-e2e" \
    npm publish "$tarball" --registry http://127.0.0.1:4874/ --tag e2e --provenance=false
done
```

The default registry is `http://127.0.0.1:4874/`, overridable with `BLACKBOX_TEST_REGISTRY`. The project directory
the journey installs into is `e2e/`.

> **The journey resets its fixture.** Use a disposable checkout, or preserve wanted `e2e/.blackbox/` evidence first.
> Preparing the consumer stops prior E2E Capsules and resets generated experiments, reports, temporary files,
> instrumentation, clients, and driver state. It reinstalls the tracked instrumentation files before it returns, so
> a prepared checkout is clean, but anything you wanted under `e2e/.blackbox/` is gone. Run one journey at a time in
> a checkout.

## Run unattended or walk through interactively

Install the published packages into the consumer, then run the acceptance journey:

```sh
pnpm run prepare:consumer
pnpm run test:demo </dev/null
```

For a walkthrough in a terminal, drop the redirect:

```sh
pnpm run prepare:consumer
pnpm run test:demo
```

The terminal walkthrough opens the report viewer and waits for Enter between steps. Redirecting stdin disables those
pauses and browser opening; `CI=true` alone does not select unattended mode.

`prepare:consumer` runs [`scripts/consumer/prepare.mjs`](../../scripts/consumer/prepare.mjs). It installs the ten
public packages from the registry into a throwaway consumer outside the workspace, then installs the project's
Node driver and instrumentation there too. It builds nothing and packs nothing. The acceptance journey,
[`demo/acceptance/capsule-test.sh`](../../demo/acceptance/capsule-test.sh), uses that consumer's CLI and
project-local driver SDK, so it checks the package boundary as well as runtime behavior.

A narrated walkthrough of the same journey is also available:

```sh
pnpm run prepare:consumer
pnpm run test:demo:storyboard
```

[`demo/storyboard/capsule-player.sh`](../../demo/storyboard/capsule-player.sh) plays
[`demo/storyboard/capsule-demo.yaml`](../../demo/storyboard/capsule-demo.yaml) against the same consumer.

Stop the registry when done:

```sh
docker rm --force blackbox-test-registry
```

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
| `e2e/.blackbox/tmp/capsule-assets/`               | Package boundary checks and consumer preparation receipt.                               |
| `e2e/.blackbox/tmp/capsule-test.*/`               | Command outputs, telemetry proofs, report checks, cleanup evidence, and journey receipt. |
| `e2e/.blackbox/experiments/capsule-<session-id>/` | Retained session, activities, startup progress, sandbox and collector records.           |
| `e2e/.blackbox/reports/capsule-<session-id>/`     | Exported JSON and HTML snapshots.                                                        |

The journey cleans its temporary consumer and owned runtime resources. A subsequent run resets the fixture's
generated output, so preserve evidence you need before rerunning. Review telemetry and command output before sharing.

## Diagnose a failed run

| Symptom                                  | Next check                                                                                                                                 |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `prepare:consumer` fails to resolve a package | Check that the registry is running (`docker logs blackbox-test-registry`) and serves the version recorded in `lerna.json`.            |
| Startup or readiness failure             | Inspect retained progress and sandbox records, Docker access, image builds, and fixture configuration.                                     |
| Expected spans do not arrive             | Inspect activation and collector status, then the exact session/activity/trace. Read [observation limits](../../docs/runtime-evidence.md). |
| Viewer port conflict                     | Check the owning viewer; the default is port `4310`. An unrelated listener is not stopped automatically.                                   |
| Banner appears but command exits nonzero | Read cleanup output and retained ownership records. The run has not passed.                                                                |

For package development, run `pnpm lint`, `pnpm typecheck`, and `pnpm test` separately. Package tests and helper tests
do not replace the Docker-backed journey. CI runs the same journey in the `demo` job of the
[E2E workflow](../../.github/workflows/e2e.yml). The `build` job publishes the packages once; `storyboard`,
`journeys` (one matrix leg per golden), `playwright`, `skills` and `transport` run beside `demo`, and the `gate` job
(the required `Capsule E2E (Testcontainers)` check) requires every one of them to succeed. Each lane retains its
outputs as the `ci-evidence-<run>-<attempt>-<job>-<project>` artifact even when the run fails. See [contributing](../../CONTRIBUTING.md) for
the development workflow.
