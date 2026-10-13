# Blackbox Feature

`@suites/blackbox-feature` compiles a reviewed Gherkin Feature into a native
Blackbox Playwright suite. Feature files are optional; you can also
[write a scoped TypeScript Gherkin specification directly](../../docs/gherkin.md#run-a-typescript-specification-directly).

## Generate your first suite

Start with [the Feature authoring guide](../../docs/gherkin.md#compile-a-separate-feature-file) to create
`tests/api-health.feature` and connect it to your project's `api` client. Then:

```sh
pnpm exec blackbox feature file validate tests/api-health.feature --clients tests/clients.ts
pnpm exec blackbox feature suite emit tests/api-health.feature --clients tests/clients.ts --output tests/api-health.spec.ts
pnpm exec playwright test tests/api-health.spec.ts
```

Emission creates a new `.spec.ts` file and refuses to overwrite an existing one.
Follow [the compiler workflow](../../docs/gherkin.md#compile-a-separate-feature-file)
for prerequisites, expected output, and drift checks after changes.

The current compiler accepts a defined
[HTTP vocabulary](src/cli/README.md).
Native Playwright suites can use other SDK clients; see
[the adapter reference](../playwright/README.md).

## Reference

- [Authoring routes](../../docs/gherkin.md): author, generate, and maintain suites.
- [CLI reference](src/cli/README.md): command arguments and availability.
- [Compiler design](DESIGN.md): compilation and runtime responsibilities.
