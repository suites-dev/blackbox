# Blackbox Feature

`@suites/blackbox-feature` compiles a reviewed Gherkin Feature into a native
Blackbox Playwright suite. Feature files are optional; you can also
[write suites directly](../playwright/README.md).

## Generate your first suite

Create `tests/api-health.feature` with a catalog system tag and a supported
HTTP sentence, then connect it to your project's `api` client. Run
`blackbox feature step list` to see the supported vocabulary. Then:

```sh
pnpm exec blackbox feature file validate tests/api-health.feature --clients tests/clients.ts
pnpm exec blackbox feature suite emit tests/api-health.feature --clients tests/clients.ts --output tests/api-health.spec.ts
pnpm exec playwright test tests/api-health.spec.ts
```

Emission creates a new `.spec.ts` file and refuses to overwrite an existing one.
Use `blackbox feature suite validate` to detect drift after changing the Feature.
The [CLI reference](src/cli/README.md) lists the command arguments and boundaries.

Generated suites use native `test.describe`, `test.use({ blackbox: { system, clients } })`,
and callable `test`. System and subsystem tags are checked against the Catalog
before generation. The emitted selection keeps the resolved kind so a later
Catalog kind change fails at execution; the acceptance tag only labels tests. `@sandbox` names an
ordinary native describe, and every physical attempt owns a fresh Sandbox.

Register project client SDK types through the exported `BlackboxClients` interface
as described in the [Playwright package guide](../playwright/README.md). A scoped
`blackbox` option replaces the whole previous value, so include any environment,
retention, or final-snapshot settings needed in that scope.

The migration removes synthetic system title wrappers and changes native test IDs.
Existing retained attempts remain available; their history identities are not
automatically comparable with newly authored tests.

The current compiler accepts a defined HTTP vocabulary. Native Playwright
suites can use other SDK clients for workflows outside that vocabulary.

## Reference

- [CLI reference](src/cli/README.md): command arguments and availability.
- [Compiler design](DESIGN.md): compilation and runtime responsibilities.
