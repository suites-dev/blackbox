# Blackbox Playwright

`@suites/blackbox-playwright` runs each physical Playwright test attempt in a
fresh Sandbox selected from the project's Blackbox catalog. It composes native
Playwright fixtures; it does not wrap the Playwright runner or share application
state between tests.

## Use

Configure the catalog once in `playwright.config.ts`. The path is resolved
relative to that file; every test still selects its system or subsystem.

```ts
import { defineConfig } from '@suites/blackbox-playwright/config';
import type { BlackboxReporterOptions } from '@suites/blackbox-playwright/reporter';

export default defineConfig({
  blackboxConfigFile: './blackbox.config.yaml',
  testDir: './tests/system',
  fullyParallel: true,
  reporter: [
    ['list', { printSteps: true }],
    [
      '@suites/blackbox-playwright/reporter',
      {
        sandboxLifecycle: true,
      } satisfies BlackboxReporterOptions,
    ],
    ['html', { open: 'never' }],
  ],
});
```

```ts
import { expect, test } from '@suites/blackbox-playwright';

test.use({
  catalogEntry: { kind: 'system', id: 'subscription-system' },
});

test('reports ready', async ({ request, sandbox, telemetry, effects }) => {
  const response = await request.get('/health');
  expect(response.ok()).toBe(true);
  expect(sandbox.catalogEntry.id).toBe('subscription-system');
  expect(telemetry.executionId).toBe(sandbox.executionId);
  expect(effects.executionId).toBe(sandbox.executionId);
});
```

The selected ID must exist in `blackbox.config.yaml`, and its declared kind must
match `system` or `subsystem`. The catalog is resolved for every physical
attempt, including retries. Setup starts
the catalog-selected Compose services, installs the current Node activation
adapter where configured, starts the collector, verifies activation, waits for
application readiness, and then enters the test body.

The fixture always requests Sandbox cleanup after the test body. Assertion
failure, timeout, skip, and interruption are retained as distinct cleanup
reasons. Setup failure also attempts cleanup before surfacing the error.

## Fixtures

- Playwright's `request` and `page` use the selected entrypoint as `baseURL`.
- `sandbox` exposes read-only attempt, catalog, entrypoint, container, and
  artifact identity. Lifecycle control remains fixture-owned.
- `telemetry` exposes the attempt identity, live collector status, and raw
  retained session or trace reads.
- `effects` exposes the attempt identity and the contract-evaluation boundary.
  `expect(effects).toSatisfy(...)` compiles and delegates an immutable contract,
  but the default fixture has not yet connected requests to trusted activity
  selections. It therefore reports an inconclusive failure. The internal
  projection pipeline below prepares that integration.

## Validate the internal effects pipeline

The package now owns an internal path from explicitly selected activities to
retained OTLP, normalized effects, and the existing `toSatisfy` matcher. The
[pipeline tests](src/effects/testing/pipeline.test.ts) exercise this path through
a real loopback collector with synthetic OTLP inputs, including nested cases and
their assertions. They do not replace a released-package Playwright acceptance run.

From the repository root, after installing and building workspace dependencies:

```sh
pnpm --filter @suites/blackbox-playwright test
```

[The composition factory](src/effects/scoped-effects.ts) takes an immutable,
registry-owned selection. Stimulus selections exclude setup and inspection;
combining purposes requires an explicit procedure selection. Collector shutdown
and activity completion never establish telemetry completeness. Observed positive
evidence can satisfy a contract, definite contradictions can fail it, and missing
evidence stays inconclusive under both positive and negated assertions.

The initial projection recognizes structured HTTP, RPC, database, cache, and
messaging operations. A database namespace is not a table; Redis keys remain
unknown without a supported key convention. SQL text, span names, `lab.*`
annotations, parent links, and timestamps do not supply missing semantics.
Effects describe observed operations, not durable state; state inspection remains
a separate activity. With no completeness or ordering attestation, absence,
exact counts, and universal ordering generally remain inconclusive.

The internal admission boundary rejects oversized selections rather than sampling:
eight selected traces, 256 distinct span identities, 256 KiB of selected payloads
including repeated arrivals, and 32 KiB per record. Each registry permits 256
activity registrations. [The named limits](src/activities/limits.ts) apply to this
initial integration and do not establish production load capacity.

The remaining integration work is to connect public request/browser execution and
inspection to this registry using the upcoming grouping API, then run consumer
tests against the selected published release. The internal factory is not a
public authoring API. Shared sandboxes must not imply shared effects selections.

## Execution reporting

Playwright's native reporter owns test progress, steps, colors, errors, and the
final summary. Blackbox adds two short messages through the test's captured
stdout, so Playwright associates them with the right parallel attempt:

```text
Blackbox: sandbox ready for system "subscription-system"
... native Playwright test and step output ...
Blackbox: sandbox cleaned up for system "subscription-system"
```

Ready means acquisition, instrumentation, and application readiness have passed.
Cleanup failure prints `sandbox cleanup failed` instead of claiming success.
Set `sandboxLifecycle: false` to suppress these messages while retaining diagnostics.
The option defaults to `true` when the Blackbox reporter is configured; without
that reporter, fixtures do not print lifecycle messages. Use any native reporter
alongside Blackbox. If no terminal reporter is configured, Playwright adds its
default one.

Fixtures attach sanitized `blackbox-progress` events and a final
`blackbox-attempt` JSON document to Playwright results, including failures.
Other Playwright reporters retain these attachments too. Startup observations
are bounded; the attempt document records how many were omitted.
The Blackbox reporter also adds a readable `blackbox-diagnostics` attachment.
Container health polling and detailed startup events stay in these attachments,
not the live console. Native reporters may display attachments for failed tests.

The retained telemetry summary reads request/span counters from the lifecycle
record without loading raw trace fragments. Collector shutdown is reported from
its retained status. Neither a span count nor a
completed collector shutdown proves that a business workflow finished; the test
must await its completion boundary before asserting behavior. The internal effect
evaluator returns scope, witness, and uncertainty diagnostics; fixture attachment
of these diagnostics remains part of the pending integration.

Public activity-scoped projection, accepted baselines, drivers, and shared worker
sandboxes remain outside this package's current surface.
