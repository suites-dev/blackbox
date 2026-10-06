# Emit and run a Playwright suite

The compiler translates reviewed Features into native Playwright declarations. It does not ask the implementation agent to invent the assertion bodies each time.

## Configure the compilation

```yaml
schemaVersion: 1
blackboxConfigFile: blackbox.config.yaml
features:
  - features/**/*.feature
outputDir: .features-gen
sandboxes:
  default:
    environment:
      FIXTURE_CONTROL_TOKEN: { fromEnv: BLACKBOX_E2E_FIXTURE_TOKEN }
    credentials:
      fixture-control: { scheme: bearer, fromEnv: BLACKBOX_E2E_FIXTURE_TOKEN }
changes:
  spec: []
  neutral:
    - "**/*.md"
```

Save as `blackbox.feature.yaml`. Paths resolve relative to this file. Supply the token through the runner environment and keep it out of Features, generated source, and Git. Add `.features-gen/` to `.gitignore`.

## Compile

The target interface is `blackbox feature suite emit --file feature.feature`. The incoming preview command is:

```sh
blackbox feature compile --config blackbox.feature.yaml
```

Output includes a generated test file per Feature and `compile-manifest.json`. The manifest identifies scenario locations, requirement IDs, selection, deadlines, library identity, and feature/generated-file hashes. All output is emitted together or compilation fails.

## Generated runtime versus hand-authored tests

Generated code imports its runtime from `@suites/blackbox-gherkin`. A developer-authored test imports `test` and `expect` from `@suites/blackbox-playwright`. Both use the same system/Sandbox grouping; they are not the same literal source code.

```ts
import { expect, test } from '@suites/blackbox-playwright';

test.system('subscription-system', (system) => {
  system.sandbox('default', (suite) => {
    // A fresh isolated Sandbox is created for each test attempt.
    suite.test('health responds', async ({ request, sandbox }) => {
      const response = await request.get(new URL('/health', sandbox.entrypoint.url).href);
      expect(response.status()).toBe(200);
    });
  });
});
```

Do not edit emitted code. Change the accepted Feature or upgrade the compiler/library through review, then compile again.

## Run

Point a Blackbox Playwright config's `testDir` at `.features-gen` and set `blackboxConfigFile` to the catalog. Then:

```sh
npx playwright test
npx playwright show-report
```

For incoming strict Gherkin verification, use `defineGherkinConfig` from `@suites/blackbox-gherkin/config` with `gherkinConfigFile: new URL('./blackbox.feature.yaml', import.meta.url)`. It adds strict run manifests and policy checks. See the [complete guarded configuration](../examples/playwright.feature.config.ts) and [CI guide](../playwright/ci.md).

## Source contract

[Compiler contract](https://github.com/suites-dev/blackbox/blob/f52ef2adf561e3222bb0c298abc4835e3c9b8c18/packages/gherkin/README.md). [Verification integration](https://github.com/suites-dev/blackbox/pull/165).

---

[Documentation](../README.md)
