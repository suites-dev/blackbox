# Blackbox Feature

`@suites/blackbox-feature` compiles a reviewed Gherkin Feature into a native
Blackbox Playwright suite. Feature files are optional; you can also
[write suites directly](../../docs/playwright/README.md).

## Generate your first suite

Start with [Writing a Feature](../../docs/features/authoring.md) to create
`tests/api-health.feature` and connect it to your project's `api` client. Then:

```sh
pnpm exec blackbox feature file validate tests/api-health.feature --clients tests/clients.ts
pnpm exec blackbox feature suite emit tests/api-health.feature --clients tests/clients.ts --output tests/api-health.spec.ts
pnpm exec playwright test tests/api-health.spec.ts
```

Emission creates a new `.spec.ts` file and refuses to overwrite an existing one.
Follow [Generating Playwright suites](../../docs/features/generating-suites.md)
for prerequisites, expected output, and drift checks after changes.

The current compiler accepts a defined
[HTTP vocabulary](../../docs/features/authoring.md#sentence-reference).
Native Playwright suites can use other SDK clients; see
[testing asynchronous flows](../../docs/guides/testing-async-flows.md).

## Reference

- [Feature guides](../../docs/features/README.md): author, generate, and maintain suites.
- [CLI reference](src/cli/README.md): command arguments and availability.
- [Compiler design](DESIGN.md): compilation and runtime responsibilities.
