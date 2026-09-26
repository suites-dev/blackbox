# `@suites/blackbox-cli`

This is a private, unpublished workspace package. Use the [source-checkout journey](../../docs/getting-started.md)
to try it and the [current CLI reference](../../docs/cli.md) for implemented commands.

The CLI is Blackbox's command-line composition root. It turns oclif commands into
calls to the catalog, Capsule, driver, instrumentation, and report packages, then
adapts their typed results for terminal or JSON output. Keep domain behavior in
those packages; this package owns argument parsing, presentation, process exit
behavior, and orchestration across package boundaries.

## Implemented command surface

Run commands from the project directory that contains `blackbox.config.yaml`.
The complete option-level contract lives in the [CLI reference](../../docs/cli.md)
and generated `--help` output.

| Group             | Implemented commands                                           | Delegates to                                                                                                                                                                            |
| ----------------- | -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Catalog           | `catalog validate`, `catalog list`                             | [`catalog`](../catalog/README.md) parses and validates project and Compose inputs.                                                                                                      |
| Project setup     | `driver install --runtime node`, `inst install --runtime node` | [`driver`](../driver/src), [`instrumentation`](../instrumentation/src), and [`instrumentation-runtime-node`](../instrumentation-runtime-node/src) produce project-local runtime assets. |
| Capsule lifecycle | `capsule start`, `capsule exec`, `capsule stop`                | [`capsule`](../capsule/README.md) acquires resources, retains activities, and cleans up owned resources. The CLI supplies Node runtime activation adapters when starting a Capsule.     |
| Evidence          | `observations --session <id>`                                  | `capsule` reads retained observations at session, activity, or trace scope.                                                                                                             |
| Reports           | `capsule report serve`, `capsule report export`                | `capsule` projects retained records; [`report-server`](../report-server/README.md) serves the local read-only viewer.                                                                   |

The reserved `setup init`, `skill install discovery`, `history`, `report`, and
`effects baseline update --run <id>` routes deliberately fail closed with exit
code `3`. They are planned command contracts, not working integrations. The CLI
must not report a successful artifact until a backend exists.

## Typical flow

```text
blackbox inst install --runtime node
blackbox catalog validate --json
blackbox catalog list --json
blackbox capsule start --system <system-id> --json
blackbox capsule exec --session <session-id> -- <command>
blackbox observations --session <session-id> --json
blackbox capsule report export --session <session-id> --format html
blackbox capsule stop --session <session-id> --json
```

`capsule start` delegates acquisition and returns only after startup and
readiness work completes. `capsule exec` runs a host command unless `--driver <name>`
selects a catalog driver; the driver's declaration decides whether execution is
on the host or in a participant container. `--purpose` records `setup`,
`stimulus`, or `inspection` intent but does not make a command read-only.

Report serving and export are separate operations. `serve` starts or reuses the
local read-only viewer (port `4310` by default); `export` writes an exact session
snapshot as HTML or JSON. See [Reports](../../docs/reports.md) for ownership,
shutdown, and output behavior.

## Architecture

```text
bin/run.js
   │ oclif discovers compiled src/commands/** modules
   ▼
command adapters ──► catalog / capsule / instrumentation / driver packages
   │                                      │
   ├──► terminal progress and JSON        └──► retained project artifacts
   └──► report adapters ──► report-server ───► local viewer or exported snapshot
```

- [`bin/run.js`](bin/run.js) is the executable entry point. oclif discovers
  compiled command modules under `dist/commands` from the package configuration.
- [`src/commands`](src/commands) contains thin command adapters: parse flags,
  construct typed package inputs, select output mode, and map failures to exit
  codes.
- [`src/capsule`](src/capsule) owns CLI-only Capsule presentation, including
  progress rendering, interactive execution, and failure formatting.
- [`src/reporting`](src/reporting) bridges Capsule report projections to local
  serving, browser launch, and portable export.
- [`src/driver/installation`](src/driver/installation) creates the
  project-owned `.blackbox/drivers` runtime without taking ownership of user
  dependencies or protocol tools.
- [`src/contract`](src/contract) implements fail-closed reserved commands.
- [`src/index.ts`](src/index.ts) exports only the shared CLI exit contract. It is
  not a programmatic command API.

The package writes operational state beneath the target project's `.blackbox/`
directory. Instrumentation installation manages `.blackbox/instrumentation`;
driver installation manages `.blackbox/drivers`; Capsule and report commands
retain experiments and report artifacts. Preserve the ownership and conflict
checks in the delegated packages when changing CLI flows.

## Maintainer workflow

From the repository root after the frozen workspace install. On a fresh checkout,
run `pnpm build` first so the CLI's workspace dependencies have their built exports:

```sh
pnpm --filter @suites/blackbox-cli build
pnpm --filter @suites/blackbox-cli lint
pnpm --filter @suites/blackbox-cli test
node packages/cli/bin/run.js --help
```

The package test runner compiles source and tests into a temporary directory,
asserts that emitted tests were discovered, and then uses Node's test runner.
Command integration coverage lives alongside the relevant adapter; reusable
process fixtures are under [`src/testing`](src/testing). For a full source-checkout
Capsule journey, follow [Your first Capsule](../../docs/getting-started.md).

When adding a command, add its oclif module under `src/commands`, keep domain
logic in the owning package, cover human and JSON/error behavior where relevant,
and update the [CLI reference](../../docs/cli.md). Do not document a reserved
route as available until its backend is wired and tested.
