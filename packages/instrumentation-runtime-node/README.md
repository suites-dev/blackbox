# Node Instrumentation Runtime

`@suites/blackbox-inst-runtime-node` is the private Node-specific leaf package for
Blackbox instrumentation. It supplies the project-local OpenTelemetry bundle,
dependency preparation, activation instructions, and Capsule activation adapters.

This package is not published as a supported npm dependency. The CLI is its
composition root; runtime-neutral installation and Capsule packages consume generic
contracts rather than depending on this Node implementation.

```text
blackbox inst install --runtime node
        v
.blackbox/instrumentation/
|- package.json          pinned, private OpenTelemetry dependency tree
|- instrumentation.js    CommonJS preload bootstrap
`- node_modules/         installed with npm and lifecycle scripts disabled

blackbox capsule start
        `-> CLI adapter -> read-only Capsule mount -> NODE_OPTIONS -> collector
```

## What This Package Owns

- [`nodeRuntimeProvider`](src/runtime/bootstrap/provider.ts), which adapts the Node
  bundle to the generic runtime installation contract.
- The generated [`package.json` and `instrumentation.js`](src/runtime/bootstrap/bundle.ts)
  contents, including exact OpenTelemetry versions.
- Dependency verification and an `npm install` preparation step for the standalone
  instrumentation directory.
- `node-preload` and `node-esm` activation construction.
- [`nodeRuntimeActivationAdapters`](src/runtime/bootstrap/adapters.ts), which tell
  Capsule how to mount the installed assets and extend `NODE_OPTIONS`.
- A helper for constructing the Blackbox and standard OTLP trace environment.
- The versioned installed-package [JSON Schema](src/runtime/schema/node-instrumentation-package-v1.json).

It does not own safe file installation, catalog activation declarations, container
mounting, collector lifecycle, telemetry retention, or reporting. Those belong to
the generic instrumentation, Catalog, Capsule, Sandbox, and collector packages.

## Install And Activation Flow

The [CLI install command](../cli/src/commands/inst/install.ts) passes
`nodeRuntimeProvider` to the generic
[`installInstrumentation()`](../instrumentation/src/installation/install.ts). That
layer owns `.blackbox/instrumentation`, containment checks, conflict detection,
locking, and managed-file writes. The Node provider contributes two files and then
prepares their pinned dependencies.

Preparation first checks every expected package version and verifies that its module
entry can be resolved. If anything is absent, stale, or corrupt, it runs:

```text
npm install --ignore-scripts --no-audit --no-fund --no-package-lock --save=false
```

The installer reports `installed` only after checking the resulting tree again. It
does not overwrite conflicting managed files, run package lifecycle scripts, or
create a lockfile.

Activation is separate from installation:

| Adapter        | `NODE_OPTIONS` addition                                  | Intended entrypoint |
| -------------- | -------------------------------------------------------- | ------------------- |
| `node-preload` | `--require=<mounted instrumentation.js>`                 | CommonJS            |
| `node-esm`     | OpenTelemetry experimental loader, then the same preload | ESM                 |

For Capsule, the [CLI start command](../cli/src/commands/capsule/start.ts) injects
the exported adapter descriptors. Capsule resolves the catalog activation, validates
that its asset stays inside `.blackbox/instrumentation`, and creates a read-only
`/blackbox/instrumentation` mount. Sandbox preserves an existing `NODE_OPTIONS`
value before appending the adapter value; see
[`participantTelemetry()`](../capsule/src/manager/telemetry/participants.ts) and
[`participantEnvironment()`](../sandbox/src/telemetry/environment.ts).

This dependency direction is intentional: the Node runtime depends on
`@suites/blackbox-instrumentation-internal` for provider and adapter types. The CLI
may select the Node leaf package, but Capsule and Sandbox receive only generic
activation descriptors.

## Bootstrap And Telemetry Contract

The installed bootstrap starts the OpenTelemetry Node SDK with automatic Node
instrumentations and an async-local-storage context manager. In Blackbox mode it
posts an authenticated activation record, exports traces over OTLP HTTP/JSON, and
continues an optional W3C `TRACEPARENT` inherited through the process environment.

[`createNodeTelemetryEnvironment()`](src/runtime/bootstrap/environment.ts) produces
the complete standalone environment contract:

| Variables                                                            | Purpose                                    |
| -------------------------------------------------------------------- | ------------------------------------------ |
| `BLACKBOX_OTEL_TRACES_ENDPOINT`, `BLACKBOX_OTEL_ACTIVATION_ENDPOINT` | Collector trace and activation URLs        |
| `BLACKBOX_OTEL_AUTH_TOKEN`                                           | Bearer token used for both requests        |
| `BLACKBOX_OTEL_SESSION_ID`, `BLACKBOX_OTEL_EXECUTION_ID`             | Evidence identity                          |
| `BLACKBOX_OTEL_SERVICE_NAME`, `BLACKBOX_OTEL_RUNTIME=node`           | Participant identity                       |
| `OTEL_SERVICE_NAME`, `OTEL_EXPORTER_OTLP_*`                          | OpenTelemetry trace exporter configuration |
| `OTEL_METRICS_EXPORTER=none`, `OTEL_LOGS_EXPORTER=none`              | Explicitly disable metrics and logs        |

Capsule does not currently call this helper. Sandbox constructs the equivalent
participant environment from the live collector and session state.

`BLACKBOX_OTEL_TRACES_ENDPOINT` enables Blackbox-specific export and activation.
When it is absent, the activation promise resolves as skipped and the SDK can still
use ordinary OpenTelemetry environment configuration. When it is present, all
Blackbox identity, endpoint, and token values are required.

## Current Support Boundary

- The installed bundle declares Node `^18.19.0 || >=20.6.0`; repository development
  uses the stricter root toolchain requirement.
- Only `node-preload` and `node-esm` are implemented. `node-register` is not accepted.
- The ESM path uses Node's `--experimental-loader` and OpenTelemetry's installed
  `hook.mjs`; changing either path requires a real ESM integration run.
- This package provides automatic Node spans and trace export only. It does not
  collect OpenTelemetry metrics or logs.
- Missing runtime dependencies, invalid inherited `TRACEPARENT`, or failed Blackbox
  activation fail application startup loudly rather than silently losing evidence.
- Shutdown is requested on `beforeExit`, `SIGINT`, and `SIGTERM`. Existing
  application signal listeners retain ownership after telemetry shutdown.
- Catalog participants with unconfigured activation are not instrumented.

The root [export surface](src/index.ts) ties these pieces together. Keep its bundle
constants, schema, dependency checks, activation paths, CLI composition, and Capsule
fixtures aligned. Because the bootstrap is an embedded string, a successful build
does not prove that a spawned application can load it.

## Validate Changes

Run package checks from the repository root:

```sh
pnpm --filter @suites/blackbox-inst-runtime-node lint
pnpm --filter @suites/blackbox-inst-runtime-node build
pnpm --filter @suites/blackbox-inst-runtime-node test
pnpm exec prettier --check packages/instrumentation-runtime-node/README.md
```

`test` runs the unit configuration and excludes `*.integration.test.ts`. Changes to
dependency installation, the generated bootstrap, CommonJS/ESM loading, propagation,
or signal behavior also require the separate integration lane:

```sh
pnpm --filter @suites/blackbox-inst-runtime-node test:integration
```

That lane performs real temporary-project dependency installs and spawns Node
applications, so it can require registry access and takes longer than the unit suite.
