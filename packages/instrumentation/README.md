# Instrumentation Core

`@suites/blackbox-instrumentation-internal` provides the shared installation and
Capsule activation contracts for project-local runtime instrumentation.

This is a private workspace package (`"private": true`). It is not published or a
supported external API. Maintainers should consume it through workspace package
imports rather than reaching into `src/`.

## Where it fits

```text
runtime provider ──> installInstrumentation ──> .blackbox/instrumentation
       │                                                │
       │                                                │ read-only mount
       v                                                v
CLI: inst install       CLI: capsule start ──> Capsule activation
                         injects adapters      from catalog runtime + adapter + ref
```

The package is neutral about the instrumented application runtime. It defines the
common provider and activation data models, but it does not own Node.js assets,
dependency installation, or `NODE_OPTIONS` policy.

## Package boundaries

| Package                                                               | Responsibility                                                                                                                                                           |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| This package                                                          | Select a provider, safely install its declared files, run its preparation callback, and define runtime-neutral activation adapter types.                                 |
| [`instrumentation-runtime-node`](../instrumentation-runtime-node/src) | Supply the Node provider, bundled OpenTelemetry bootstrap, dependency preparation, and the current `node-preload` and `node-esm` activation adapters.                    |
| [`cli`](../cli/src/commands)                                          | Choose the supported provider for `inst install`; inject Node activation adapters when starting a Capsule.                                                               |
| [`capsule`](../capsule/src/manager/telemetry/participants.ts)         | Match catalog runtime and adapter names, validate the activation asset, mount the instrumentation directory read-only, and materialize the environment append operation. |
| [`catalog`](../catalog/src/model/catalog-types.ts)                    | Supply each participant's runtime and the selected activation's adapter and project-relative asset reference.                                                            |

Keep runtime-specific branching out of this package and Capsule. A runtime package
should provide data that satisfies these contracts, and the application layer
should inject that data.

## Installation contract

[`RuntimeInstrumentationProvider`](src/installation/model.ts) declares:

- a stable `runtime` key and display name;
- the exact managed files and their content;
- human-readable activation instructions returned to the CLI; and
- an asynchronous `prepare({ directory })` callback for runtime-owned setup.

[`installInstrumentation`](src/installation/install.ts) selects the provider whose
`runtime` matches the request and installs under `.blackbox/instrumentation`. It:

1. rejects unsafe or escaping directories and symlinked managed paths;
2. refuses to overwrite a managed file whose content differs;
3. uses `.install.lock` to reject overlapping installation attempts;
4. writes only missing managed files and preserves matching and unrelated files;
5. invokes the selected provider's preparation callback; and
6. returns a discriminated success or failure result instead of throwing expected
   installation failures.

The provider owns the meaning of dependency preparation. For example, the Node
provider installs and verifies its dependencies; the core only reports its
`installed` or `unchanged` result.

`RuntimeActivationInstruction` belongs to this installation flow. It is prose and
a command for a person running an instrumented application. It is not the Capsule
activation adapter described next.

## Capsule activation contract

[`RuntimeActivationAdapter`](src/activation/model.ts) is declarative data with:

- `runtime` and `adapter` selection keys;
- the project-relative source directory to mount;
- the target directory inside the participant container; and
- one `append-environment-variable` recipe.

The environment value is assembled from ordered parts:

- `activation-asset-path` refers to the catalog-selected activation asset after it
  is mapped into the container.
- `mounted-relative-path` refers to another file below the adapter's mounted target
  directory.

The current Node runtime package exports two adapters:

| Adapter        | Capsule environment behavior                                                                                |
| -------------- | ----------------------------------------------------------------------------------------------------------- |
| `node-preload` | Appends `--require=<mounted activation asset>` to `NODE_OPTIONS`.                                           |
| `node-esm`     | Appends the mounted OpenTelemetry loader and then `--require=<mounted activation asset>` to `NODE_OPTIONS`. |

[`capsule start`](../cli/src/commands/capsule/start.ts) is currently the composition
root: it passes `nodeRuntimeActivationAdapters` into Capsule. Capsule remains
runtime-agnostic and resolves an adapter by the catalog participant's `runtime`
plus the activation's `adapter` name.

When extending runtime support, update the provider and adapter data in the runtime
package, inject it at the application boundary, and add consumer tests. Do not add
runtime-name conditionals to the generic installer or Capsule materializer.

## Workspace export surface

[`src/index.ts`](src/index.ts) is the only package export. It exposes:

- `installInstrumentation` and `instrumentationDirectoryRelativePath`;
- installation provider, input, result, and failure types; and
- `RuntimeActivationAdapter` plus its environment and value-part types.

The package export map points workspace development at `src/index.ts` through the
`blackbox-source` condition and built consumers at `dist/index.js` and its types.

## Validate changes

From the repository root:

```bash
pnpm --filter @suites/blackbox-instrumentation-internal build
pnpm --filter @suites/blackbox-instrumentation-internal lint
pnpm --filter @suites/blackbox-instrumentation-internal test
pnpm --filter @suites/blackbox-instrumentation-internal test:integration
```

`test` uses [`vitest.config.ts`](vitest.config.ts): it includes `*.test.ts` and
excludes `*.integration.test.ts`. It covers installation state, conflict handling,
result modeling, and filesystem safety.

`test:integration` uses
[`vitest.integration.config.ts`](vitest.integration.config.ts): it runs only
`*.integration.test.ts`. In this package, that lane exercises concurrent lock
ownership and cleanup. End-to-end Node bootstrap and dependency behavior belongs
to the adjacent runtime package's integration lane.

Update this README when the root export surface, provider result model, activation
value parts, or package boundary changes.
