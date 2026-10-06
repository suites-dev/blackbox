# Playwright API

Import the native integration from its public adapter, not the main composition package:

```ts
import { expect, test } from '@suites/blackbox-playwright';
import { defineConfig } from '@suites/blackbox-playwright/config';
```

The baseline root export also exposes the `BlackboxSandbox`, `BlackboxTelemetry`, `BlackboxEffects`, and `EffectContractBuilder` types. Configuration and reporting have dedicated subpaths.

## Declare a system and Sandbox configuration

```ts
test.system('subscription-system', (system) => {
  system.sandbox('default', (suite) => {
    suite.test('health responds', async ({ request, sandbox }) => {
      const url = new URL('/health', sandbox.entrypoint.url).href;
      expect((await request.get(url)).status()).toBe(200);
    });
  });
});
```

A string selects a Catalog entry with kind `system`. Select a subsystem explicitly:

```ts
test.system({ kind: 'subsystem', id: 'payment-mock' }, (system) => {
  system.sandbox('default', { environment: { FEATURE_MODE: 'stable' } }, (suite) => {
    // Declare tests here; no shared live Sandbox is created by this callback.
  });
});
```

`system.sandbox(name, callback)` and `system.sandbox(name, { environment }, callback)` declare synchronous configuration groups. `environment` is a read-only string map passed as Compose substitution input for that group.

## Suite methods

| Member | Role |
| --- | --- |
| `suite.test(title, body)` | Native test callback with normal fixtures and Blackbox fixtures |
| `suite.test(title, details, body)` | Native details, including requirement annotations |
| `suite.describe(...)` | Nested grouping; native `configure` is available |
| `suite.beforeEach(...)`, `suite.afterEach(...)` | Attempt-scoped hooks |
| `suite.step(...)` or `test.step(...)` | Native steps |

`only`, `skip`, and `fixme` modifiers exist on the native declaration surface; strict verification does not turn excluded or skipped behavior into supported evidence. There is no `suite.beforeAll`/`suite.afterAll` because no live Sandbox is shared by the group.

Root `test.beforeAll`/`afterAll` can prepare non-Sandbox resources. Root `test.extend(...)` extends the native fixture set. Do not substitute root hooks for per-attempt initialization.

## `sandbox`

| Field | Meaning |
| --- | --- |
| `sandboxId` | Sandbox identity |
| `executionId` | Physical execution identity |
| `catalogEntry.id`, `.kind` | Selected Catalog entry |
| `projectName` | Owned Compose project name |
| `artifactDirectory` | Attempt artifact location |
| `entrypoint.url`, `.host`, `.port`, `.protocol` | Resolved live entrypoint |
| `containers` | Read-only map of acquired container records |

This is a read-only handle. Lifecycle remains fixture-owned; no public `sandbox.start()` or `sandbox.stop()` is established by these fields. Build request/page URLs explicitly against `entrypoint.url`; Playwright's configured `baseURL` is not rewritten.

## `telemetry`

| Member | Meaning |
| --- | --- |
| `sessionId`, `executionId` | Attempt-linked telemetry identities |
| `inspect()` | Current Sandbox telemetry status |
| `read()` | Retained collector session read result |
| `readTrace(traceId)` | Retained trace read result |

Use the exported result types and discriminants. Do not assume every read is complete or that a trace list is the whole business execution.

## `effects`

The baseline handle exposes `sessionId` and `executionId`. `expect(effects).toSatisfy(...)` delegates to a configured evaluator. The baseline does not provide complete raw-telemetry projection; without an evaluator, the result remains inconclusive. Incoming effect work is separate from the Gherkin v1 vocabulary.

## Reporter options

Configure native terminal/HTML reporters alongside `@suites/blackbox-playwright/reporter`. Baseline `sandboxLifecycle` controls short lifecycle messages; diagnostics remain attached. Incoming #155 adds `verdicts: 'strict'`, `runManifest`, and `policy` configuration. Use the [CI guide](../playwright/ci.md) and [availability map](../status.md) for that versioned contract.

## Source contract

[Types](https://github.com/suites-dev/blackbox/blob/9197de5de456285af16e4dcbcf722082217a3989/packages/playwright/src/types.ts). [Exports](https://github.com/suites-dev/blackbox/blob/9197de5de456285af16e4dcbcf722082217a3989/packages/playwright/src/index.ts). [Guide](https://github.com/suites-dev/blackbox/blob/9197de5de456285af16e4dcbcf722082217a3989/packages/playwright/README.md).

---

[Documentation](../README.md)
