# Workspace packages

All fifteen workspace packages are public alpha packages with one fixed Lerna version.
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
pnpm check:deps
pnpm typecheck
pnpm test
pnpm test:integration
```

`pnpm test` and `pnpm test:integration` each include a build. `pnpm test:integration` runs the package
`*.integration.test.ts` suites that a package's default Vitest config excludes; it needs network access to the npm
registry but not Docker. `pnpm test:repo` runs the repository's own `node:test` files by glob after a build. The [workspace definition](../../pnpm-workspace.yaml) includes `packages/*`; `e2e/`
is not itself a workspace package. It holds the project fixture the lanes drive: the catalog, the project-authored
drivers, the system under test, and the golden CLI journeys. `pnpm run test:demo` and `pnpm run test:e2e:journeys`
are active entrypoints. `pnpm run test:e2e:playwright` runs the system tests against the same project fixture.
Every lane consumes packages installed from a disposable registry.

The Playwright lane requires a prepared Chromium cache. Set `PLAYWRIGHT_BROWSERS_PATH` to an isolated writable
directory, then install the browser and its operating-system dependencies with the pinned workspace CLI before the
lane runs:

```sh
export PLAYWRIGHT_BROWSERS_PATH="$PWD/.blackbox/tmp/playwright-browsers"
pnpm --filter @suites/blackbox-playwright exec playwright install --with-deps chromium --only-shell
pnpm --filter @suites/blackbox-playwright test:browser
pnpm run test:e2e:playwright
```

The `--with-deps` form is intended for the Ubuntu CI runner. On a developer machine with the Chromium operating-system
dependencies already installed, use
`pnpm --filter @suites/blackbox-playwright exec playwright install chromium --only-shell`; `run-demo-pw.sh` follows
that local form. The package browser lane checks real Chromium propagation and cleanup before the system tests run.
The system-test lane also retains a headless browser preflight receipt and an inspectable native report at
`e2e/test-results/html/index.html` alongside its JSON and JUnit evidence.

Package and source checks run in
[Continuous Integration](../../.github/workflows/ci.yml). The separate
[E2E workflow](../../.github/workflows/e2e.yml) builds once, then runs the demo, the journeys, and the Playwright
system tests against packages installed from a disposable registry.
Passing one lane does not imply the others passed. See
[contributing](../../CONTRIBUTING.md) before making changes.

Publication runs only from an immutable annotated tag on `main`. See the
[release flow](releasing.md) for OIDC trusted publishing, provenance, and recovery.

## Dependency boundaries

`pnpm check:deps` runs [dependency-cruiser](../../.dependency-cruiser.cjs) over
`packages/` and fails on any error. CI runs it as its own lane. A package may import
only packages in a lower tier:

| Tier         | Packages                                                                                     |
| ------------ | -------------------------------------------------------------------------------------------- |
| distribution | `blackbox` (the main package a user installs; declares the default composition)              |
| host         | `cli` (loads plugins at runtime; imports only `cli-contract`)                                |
| composition  | `capsule`, `playwright`                                                                      |
| plugins      | `catalog`, `discovery`, `instrumentation-runtime-node`                                       |
| services     | `skills`, `driver`                                                                           |
| foundation   | `cli-contract`, `telemetry`, `instrumentation`, `otel-collector`, `report-server`, `sandbox` |

The same check rejects import cycles (type-only ones included), relative or deep imports into another
package, imports that miss the target's `exports`, and npm or workspace imports the
importing package does not declare. Only `playwright` imports `@playwright/test` or a
runtime adapter. A new package must be added to a tier in the config, or the check
refuses to run.

It also bounds coupling of production modules (tests, fixtures and barrels are not
measured):

- **Fan-in:** at most 15 production modules may import one module. Existing hubs are
  recorded in `.dependency-cruiser-known-violations.json` and ignored.
- **Fan-out:** a module may depend on at most 12 workspace modules
  ([`scripts/check-fan-out.mjs`](../../scripts/check-fan-out.mjs); command registries
  are also exempt). Existing violators are listed with a reason in
  [`scripts/fan-out-allowlist.json`](../../scripts/fan-out-allowlist.json).

Both lists may only shrink. The fan-out check fails on an allowlist entry that is back
under the limit. To drop a fixed fan-in hub, run `pnpm check:deps:baseline` and commit
the result; the diff must only delete entries. The config refuses a baseline that
records any rule other than `no-high-fan-in`.

ESLint enforces the function-level limits: `complexity` 15, `max-depth` 4,
`max-params` 4, `max-lines-per-function` 80 and `max-lines` 250. A function locked
above a limit carries an `eslint-disable-next-line` with its own reason.

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
