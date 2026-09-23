# Catalog workspace package

This private workspace package owns the language-neutral `blackbox.config.yaml` contract. YAML is
parsed with anchor and alias support and then validated against the shipped Draft 2020-12 JSON
Schema. Semantic checks resolve catalog references and reject paths that can leave the project
directory.

The package does not start containers. `resolveCatalogEntry` returns an explicit, structural
sandbox input with the project directory, ordered Compose files, services, endpoint requests,
readiness, and catalog metadata. The sandbox runtime consumes that data without knowing how the
catalog was authored.

```ts
import {
  listCatalogEntries,
  loadCatalogFile,
  resolveCatalogEntry,
} from '@suites/blackbox-catalog-internal';

const catalog = await loadCatalogFile({ configFile: 'blackbox.config.yaml' });
console.log(listCatalogEntries({ config: catalog.config }));
const sandboxInput = resolveCatalogEntry({
  catalog,
  selection: { kind: 'explicit-entry', entryId: 'orders' },
});
```

The CLI facade calls `runCatalogValidate({ projectDirectory })` and
`runCatalogList({ projectDirectory })`. Both use `<projectDirectory>/blackbox.config.yaml`, return
JSON-ready discriminated results, and never print or terminate the process. Validation also checks
that every declared Compose and activation file exists, is a regular file, and resolves within the
project root. Listing validates the document and returns entries ordered by ID without inspecting
runtime files.

The canonical schema is exported at
`@suites/blackbox-catalog-internal/schema/blackbox-config-v1.json`. The npm package name and public
packaging are intentionally provisional.
