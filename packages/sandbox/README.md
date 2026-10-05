# Sandbox

`@suites/blackbox-sandbox` owns the lifecycle of one isolated Docker
Compose environment. It turns already-resolved Compose inputs into a running
sandbox with mapped endpoints, inspectable resources, optional telemetry, command
execution, retained ownership records, and bounded cleanup.

This is a public alpha infrastructure package for other Blackbox packages. It is
not a standalone user-facing configuration layer.

## Where Sandbox Fits

```text
Catalog-resolved Compose plan
            |
            v
Capsule manager -----> Sandbox -----> Testcontainers / Docker Compose
   |                     |                         |
   |                     +-- endpoints/resources -+
   |                     +-- telemetry overrides
   |                     +-- execution controls
   |                     +-- lifecycle records and recovery
   v
readiness, retained experiment state, and reports
```

[Capsule](../capsule/README.md) and the native [Playwright fixtures](../playwright/README.md)
are the current workspace consumers. Both supply a resolved catalog plan and ask
Sandbox to acquire the Compose project. Capsule uses the returned handle for
endpoints, inspection, telemetry, and participant execution, and delegates cleanup
recovery back to Sandbox. See the Capsule
[manager ports](../capsule/src/manager/ports.ts),
[acquisition flow](../capsule/src/manager/acquisition.ts), and
[recovery adapter](../capsule/src/session/recovery/sandbox-cleanup.ts).

The Playwright package owns its test API and acquires this lifecycle around each
physical Playwright attempt. Sandbox itself remains test-framework neutral.

## Lifecycle And Ownership

[`SandboxRuntime.start()`](src/lifecycle/runtime.ts) validates input and persists an
admission record before touching Docker. It then starts the selected Compose
services, resolves explicitly requested endpoints, snapshots owned resources, and
returns a [`SandboxHandle`](src/model/handle.ts).

Startup waits, within `startupTimeoutMs`, until every container Compose started
has its published ports listening inside the container and, when the container
declares a Docker health check, until that check reports healthy. Neither signal
alone counts: a passing health check does not make a closed port ready. The
port check runs a shell command inside the container, so an image with neither
`/bin/sh` nor `/bin/bash` cannot pass it; this already applied to containers
without a health check. See [`readiness/wait-strategy.ts`](src/acquisition/readiness/wait-strategy.ts).

```text
validate -> admit -> start Compose -> inspect -> running -> stop -> completed
                         |                          |
                         +-> start-failed           +-> stop-failed
```

The handle provides:

- Immutable views of selected containers, mapped endpoints, and Compose-owned
  resources.
- One-shot and streaming command execution inside selected containers.
- Optional collector and participant telemetry wiring through generated Compose
  overrides.
- Idempotent stop behavior with volume removal and retained cleanup outcomes.

Lifecycle records follow the exported
[`sandbox-record-v1` schema](schema/sandbox-record-v1.json). After interruption,
[`recoverSandbox()`](src/recovery/recover.ts) uses the retained Compose project
identity to retry cleanup and record the result.

## Boundaries

Sandbox deliberately does not load `blackbox.config.yaml`, resolve catalog
entries, own Capsule sessions or reports, or decide that an application is ready.
Compose container state and Docker health observations describe acquisition;
Capsule performs its separate application-readiness check.

The caller also owns policy: which services and endpoints are allowed, what
environment is passed to Compose, whether telemetry is enabled, and when the
sandbox should stop.

## Source Map

- [`src/index.ts`](src/index.ts) defines the package export surface.
- [`src/acquisition/testcontainers-driver.ts`](src/acquisition/testcontainers-driver.ts)
  adapts Testcontainers and Docker Compose.
- [`src/lifecycle/`](src/lifecycle/) coordinates admission, startup, stop, and
  failure transitions.
- [`src/ownership/`](src/ownership/) persists and decodes lifecycle records.
- [`src/telemetry/`](src/telemetry/) creates and controls optional telemetry
  integration.
- [`src/execution/`](src/execution/) implements captured and streaming container
  execution.
- [`src/recovery/`](src/recovery/) cleans interrupted Compose projects.

## Validate Changes

Run package checks from the repository root:

```bash
pnpm --filter @suites/blackbox-sandbox lint
pnpm --filter @suites/blackbox-sandbox build
pnpm --filter @suites/blackbox-sandbox test
```

The unit suite does not opt into Docker-backed proof tests. With a disposable
local Docker environment available, run the bounded proof explicitly:

```bash
pnpm --filter @suites/blackbox-sandbox test:docker
```

The Docker proof sets `BLACKBOX_SANDBOX_DOCKER_TEST=1` and runs every
`src/**/*.docker.test.ts` file. It creates isolated Compose projects and requires its owned
containers, networks, and volumes to be removed before it succeeds. CI runs it
as the `Sandbox Docker tests` lane of the E2E workflow (`pnpm test:sandbox:docker`).
