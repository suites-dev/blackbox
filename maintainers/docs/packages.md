# Workspace packages

All ten current packages are private, unpublished workspace packages at version `0.0.0`. Names and exports are
development contracts. Use the [source workflow](../../docs/getting-started.md); there is no supported registry installation
recipe for this branch.

| Directory                                                                             | Package name                                | Responsibility                                                                                   |
| ------------------------------------------------------------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| [cli](../../packages/cli/README.md)                                                   | `@suites/blackbox-cli`                      | Compose working catalog, Capsule, driver, instrumentation, observation, and report commands.     |
| [catalog](../../packages/catalog/README.md)                                           | `@suites/blackbox-catalog-internal`         | Validate YAML and resolve catalog selections into structural sandbox inputs.                     |
| [sandbox](../../packages/sandbox/README.md)                                           | `@suites/blackbox-sandbox-internal`         | Acquire Docker Compose resources, resolve endpoints, observe startup, and clean owned resources. |
| [capsule](../../packages/capsule/README.md)                                           | `@suites/blackbox-capsule-internal`         | Own sessions, activities, execution, retained records, and report projections.                   |
| [driver](../../packages/driver/README.md)                                             | `@suites/blackbox-driver`                   | Define and prepare project Node drivers, validate execution and propagation contracts.           |
| [telemetry](../../packages/telemetry/README.md)                                       | `@suites/blackbox-telemetry-internal`       | Model execution scopes and W3C context/propagation records.                                      |
| [instrumentation](../../packages/instrumentation/README.md)                           | `@suites/blackbox-instrumentation-internal` | Install runtime instrumentation files through a provider contract.                               |
| [instrumentation-runtime-node](../../packages/instrumentation-runtime-node/README.md) | `@suites/blackbox-inst-runtime-node`        | Supply the Node bootstrap, dependencies, activation, and telemetry environment.                  |
| [otel-collector](../../packages/otel-collector/README.md)                             | `@suites/blackbox-otel-collector-internal`  | Receive and retain raw OTLP/HTTP JSON traces; read exact sessions, activities, and traces.       |
| [report-server](../../packages/report-server/README.md)                               | `@suites/blackbox-report-server-internal`   | Serve a local read-only registry and provider-owned report projections.                          |

The sandbox does not read catalogs or implement effect evaluation. The collector does not infer causal attribution
or capture completeness. The report server does not own Capsule semantics. Keeping these responsibilities separate
makes it possible to inspect which layer produced a result.

## Check the workspace

From the repository root after the frozen install:

```sh
pnpm exec lerna list --all
pnpm build
pnpm lint
pnpm typecheck
pnpm test
```

`pnpm test` includes a build. The [workspace definition](../../pnpm-workspace.yaml) includes `packages/*`; `e2e/`
is not itself a workspace package. Its older Playwright manifest references packages absent from this branch.
The root `pnpm test:e2e:capsule` script is the active E2E entrypoint.

Package and source checks run in [Continuous Integration](../../.github/workflows/ci.yml). The separate
[Capsule E2E workflow](../../.github/workflows/e2e.yml) exercises packed consumers and Docker-backed behavior.
Passing one lane does not imply the other passed. See [contributing](../../CONTRIBUTING.md) before making changes.
