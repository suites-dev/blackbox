# Catalog

`@suites/blackbox-catalog-internal` owns the language-neutral Blackbox catalog
contract and the code that loads, validates, selects, and resolves
`blackbox.config.yaml` into data that runtime packages can consume.

This is a private, unpublished workspace package. Its package name and export
surface are internal and may change.

## Where Catalog Fits

```text
blackbox.config.yaml
        |
        v
load -> validate -> select entry -> resolve structural plan
        |                              |
        |                              +-> Capsule manager -> Sandbox runtime
        +-> CLI validate/list results
```

The contract is language-neutral because the canonical
[`blackbox-config-v1` JSON Schema](schema/blackbox-config-v1.json) describes the
document independently of this TypeScript implementation. The current loader
accepts YAML, including anchors and aliases, and decodes schema-shaped values
into explicit internal types.

## Responsibilities And Boundaries

Catalog owns four related stages:

1. **Loading:** [`loadCatalogFile()`](src/loading/catalog-loader.ts) reads a
   chosen file and records its resolved source file and project directory.
2. **Validation:** YAML syntax, the bundled Draft 2020-12 schema, and semantic
   references are checked before a typed config is returned. Paths must remain
   relative to the project directory.
3. **Selection:** [`selectCatalogEntry()`](src/selection/catalog-selection.ts)
   chooses the declared default or an explicit entry. Listing is stable and
   sorted by entry ID.
4. **Resolution:** [`resolveCatalogEntry()`](src/selection/sandbox-resolution.ts)
   converts the selected entry into a `CatalogSandboxInput`: project directory,
   ordered Compose files, services, endpoint and readiness requests, resolved
   drivers, and catalog metadata.

Catalog does not start containers, map host ports, run readiness probes, execute
drivers, collect telemetry, or own cleanup. Resolution is a structural handoff,
not runtime execution. The [Capsule package](../capsule/README.md) currently
orchestrates that handoff, and the [Sandbox package](../sandbox/README.md) owns the
Docker Compose lifecycle.

## Integration Points

- **CLI:** [`runCatalogValidate()` and
  `runCatalogList()`](src/application/catalog-commands.ts) implement data-only
  command facades for the canonical project-root `blackbox.config.yaml`. They
  return discriminated, JSON-ready results and do not print or terminate the
  process. The [CLI commands](../cli/src/commands/catalog/) render those results.
- **Capsule:** the [manager catalog
  port](../capsule/src/manager/ports.ts) loads an explicit config file and
  resolves a requested system ID. Capsule then maps the returned plan into
  Sandbox startup, readiness, activation, driver, and telemetry work.
- **Schema consumers:** the canonical schema is exported as
  `@suites/blackbox-catalog-internal/schema/blackbox-config-v1.json`; the package
  root also exports the schema object, catalog operations, result types, and
  model types from [`src/index.ts`](src/index.ts).

`runCatalogValidate()` goes beyond document validation: it also checks that
referenced Compose, driver, and activation paths exist, resolve inside the real
project directory, and point to regular files. `runCatalogList()` validates the
document but intentionally does not inspect those referenced files.

A future Playwright integration may consume the same catalog contract. No
Playwright fixture, adapter, or public Playwright API is implemented here today.

## Example Internal Use

```ts
import {
  listCatalogEntries,
  loadCatalogFile,
  resolveCatalogEntry,
} from '@suites/blackbox-catalog-internal';

const catalog = await loadCatalogFile({ configFile: 'blackbox.config.yaml' });
console.log(listCatalogEntries({ config: catalog.config }));

const plan = resolveCatalogEntry({
  catalog,
  selection: { kind: 'explicit-entry', entryId: 'orders' },
});
```

`plan` is safe to pass across the catalog/runtime boundary, but creating it does
not acquire or verify any runtime resource.

## Source Map

- [`schema/blackbox-config-v1.json`](schema/blackbox-config-v1.json) is the
  canonical external contract.
- [`src/loading/`](src/loading/) parses YAML and establishes source identity.
- [`src/schema/`](src/schema/) validates, decodes, and reports structured issues.
- [`src/selection/`](src/selection/) lists, selects, and resolves entries.
- [`src/application/`](src/application/) provides CLI-facing operations and
  referenced-file checks.
- [`src/model/catalog-types.ts`](src/model/catalog-types.ts) defines the decoded
  catalog and structural handoff types.
- [`src/index.ts`](src/index.ts) defines the package export surface.

## Validate Changes

Run package checks from the repository root:

```bash
pnpm --filter @suites/blackbox-catalog-internal lint
pnpm --filter @suites/blackbox-catalog-internal build
pnpm --filter @suites/blackbox-catalog-internal test
```

Tests cover YAML loading, schema and semantic failures, referenced-file
containment, deterministic selection, and resolution. Changes to the contract
should update the JSON Schema, decoded model, fixtures, and relevant tests
together.
