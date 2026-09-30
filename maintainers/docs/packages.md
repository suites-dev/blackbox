# Workspace packages

All thirteen workspace packages are public alpha packages with one fixed Lerna version.
`pnpm exec lerna list --all` is the package source of truth, and Lerna determines
their publication order. Alpha exports may change between releases.

| Directory                                                                             | Package name                         | Responsibility                                                                                   |
| ------------------------------------------------------------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------ |
| [cli](../../packages/cli/README.md)                                                   | `@suites/blackbox-cli`               | Compose working catalog, Capsule, driver, instrumentation, observation, and report commands.     |
| [catalog](../../packages/catalog/README.md)                                           | `@suites/blackbox-catalog`           | Validate YAML and resolve catalog selections into structural sandbox inputs.                     |
| [cli-contract](../../packages/cli-contract/README.md)                                 | `@suites/blackbox-cli-contract`      | Define the shared protocol between the CLI and project-authored extensions.                      |
| [sandbox](../../packages/sandbox/README.md)                                           | `@suites/blackbox-sandbox`           | Acquire Docker Compose resources, resolve endpoints, observe startup, and clean owned resources. |
| [capsule](../../packages/capsule/README.md)                                           | `@suites/blackbox-capsule`           | Own sessions, activities, execution, retained records, and report projections.                   |
| [driver](../../packages/driver/README.md)                                             | `@suites/blackbox-driver`            | Define and prepare project Node drivers, validate execution and propagation contracts.           |
| [telemetry](../../packages/telemetry/README.md)                                       | `@suites/blackbox-telemetry`         | Model execution scopes and W3C context/propagation records.                                      |
| [instrumentation](../../packages/instrumentation/README.md)                           | `@suites/blackbox-instrumentation`   | Install runtime instrumentation files through a provider contract.                               |
| [instrumentation-runtime-node](../../packages/instrumentation-runtime-node/README.md) | `@suites/blackbox-inst-runtime-node` | Supply the Node bootstrap, dependencies, activation, and telemetry environment.                  |
| [otel-collector](../../packages/otel-collector/README.md)                             | `@suites/blackbox-otel-collector`    | Receive and retain raw OTLP/HTTP JSON traces; read exact sessions, activities, and traces.       |
| [playwright](../../packages/playwright/README.md)                                     | `@suites/blackbox-playwright`        | Compose native Playwright tests with one catalog-selected Sandbox per physical attempt.          |
| [report-server](../../packages/report-server/README.md)                               | `@suites/blackbox-report-server`     | Serve a local read-only registry and provider-owned report projections.                          |
| [skills](../../packages/skills/README.md)                                             | `@suites/blackbox-skills`            | Publish the supported agent skills for consuming Blackbox.                                       |

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
is not itself a workspace package. It holds the project fixture the lanes drive: the catalog, the project-authored
drivers, the system under test, and the golden CLI journeys. `pnpm run test:demo` and `pnpm run test:e2e:journeys`
are active entrypoints. `pnpm run test:e2e:playwright` runs the system tests against the same project fixture.
Every lane consumes packages installed from a disposable registry.

Package and source checks run in
[Continuous Integration](../../.github/workflows/ci.yml). The separate
[E2E workflow](../../.github/workflows/e2e.yml) builds once, then runs the demo, the journeys, the Playwright
system tests, and the release rehearsal against packages installed from a disposable registry.
Passing one lane does not imply the others passed. See
[contributing](../../CONTRIBUTING.md) before making changes.

Publication runs only from an immutable annotated tag on `main`. See the
[release flow](releasing.md) for OIDC trusted publishing, provenance, and recovery.

## Public surface

Every package supports only the export paths declared in its `package.json`.
Schema-bearing packages publish their listed `./schema/*.json` subpaths, and the
Driver package additionally publishes `./node-runner`. Two executable names are
published:

- `@suites/blackbox-cli` provides `blackbox`;
- `@suites/blackbox-otel-collector` provides `blackbox-otel-collector` for Capsule
  runtime composition.

The first alpha removes the temporary workspace suffix from these names:

| Previous source name                        | Public package                     |
| ------------------------------------------- | ---------------------------------- |
| `@suites/blackbox-capsule-internal`         | `@suites/blackbox-capsule`         |
| `@suites/blackbox-catalog-internal`         | `@suites/blackbox-catalog`         |
| `@suites/blackbox-instrumentation-internal` | `@suites/blackbox-instrumentation` |
| `@suites/blackbox-otel-collector-internal`  | `@suites/blackbox-otel-collector`  |
| `@suites/blackbox-report-server-internal`   | `@suites/blackbox-report-server`   |
| `@suites/blackbox-sandbox-internal`         | `@suites/blackbox-sandbox`         |
| `@suites/blackbox-telemetry-internal`       | `@suites/blackbox-telemetry`       |

`@suites/blackbox-cli`, `@suites/blackbox-driver`, and
`@suites/blackbox-inst-runtime-node` keep their source names. The original ten package
names returned not found in read-only npm registry checks on 2026-09-28. The added
`@suites/blackbox-playwright` name still needs the same registry check before first
publication. Registry absence does not prove `@suites` scope ownership; ownership
remains a first-publication gate.

Native Playwright test files import the Blackbox `test` fixture and
Playwright-compatible `expect` from `@suites/blackbox-playwright`. Its initial surface
provides catalog-selected per-attempt Sandbox and raw telemetry fixtures; effects,
drivers, and assurance are not part of that surface.
