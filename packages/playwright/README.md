# Blackbox Playwright

`@suites/blackbox/playwright` groups native Playwright tests by a catalog system
and Sandbox configuration. Every physical test attempt, including a retry, runs
in a fresh Sandbox. Tests keep their native Playwright callbacks, hooks, steps,
reporters, and parallel scheduling.

## Install

Install Playwright with the main Blackbox package and its optional physical
Playwright adapter:

```sh
npm install --save-dev @suites/blackbox@next @suites/blackbox-playwright@next @playwright/test
```

Application code imports the adapter through the `@suites/blackbox/playwright`
paths below. Installing `@suites/blackbox` alone does not install or load the
optional adapter.

For reusable activity helpers, import `BlackboxActivities`,
`BlackboxActivityActions`, `BlackboxActivityContext` and `BlackboxScopedRequest`
as types from `@suites/blackbox/playwright`. Inline callbacks also infer these types.

## Use

Configure the catalog once in `playwright.config.ts`. The path is resolved
relative to that file. Test files then select a system or subsystem and declare
one or more named Sandbox configurations.

```ts
import { defineConfig } from '@suites/blackbox/playwright/config';

export default defineConfig({
  blackboxConfigFile: './blackbox.config.yaml',
  testDir: './tests/system',
  fullyParallel: true,
  reporter: [
    ['list', { printSteps: true }],
    ['@suites/blackbox/playwright/reporter'],
    ['html', { open: 'never' }],
  ],
});
```

```ts
import { expect, test } from '@suites/blackbox/playwright';

test.system('subscription-system', (system) => {
  system.sandbox('default', { environment: { FEATURE_MODE: 'stable' } }, (suite) => {
    suite.describe('health', () => {
      suite.test('reports ready', async ({ activities, request, sandbox, telemetry, effects }) => {
        const url = new URL('/health', sandbox.entrypoint.url).href;
        const response = await test.step('When health is requested', () =>
          activities.stimulus.request('request health', request, (scoped) => scoped.get(url)));

        expect(response.ok()).toBe(true);
        await expect(effects).toSatisfy((e) => [e.exists(e.http({ method: 'GET' }))]);
        expect(sandbox.catalogEntry.id).toBe('subscription-system');
        expect(telemetry.executionId).toBe(sandbox.executionId);
        expect(effects.executionId).toBe(sandbox.executionId);
      });
    });
  });
});
```

This is a breaking migration from the flat fixture API. Replace
`test.use({ catalogEntry, blackboxEnvironment })` plus root `test(...)` calls with
`test.system(...).sandbox(...)` groups, and pass `blackboxEnvironment` as the
Sandbox option `{ environment: blackboxEnvironment }`. Relative `request` and
`page` URLs no longer target the Sandbox automatically; resolve them explicitly
against `sandbox.entrypoint.url`. Playwright's root `baseURL` remains whatever the
project configured.

A string passed to `test.system(...)` selects a catalog entry with kind `system`.
Use an object to select either kind explicitly:

```ts
test.system({ kind: 'subsystem', id: 'payment-mock' }, (system) => {
  system.sandbox('default', (suite) => {
    suite.test('accepts a payment', async ({ request, sandbox }) => {
      const url = new URL('/v1/payment_intents', sandbox.entrypoint.url).href;
      const response = await request.post(url, {
        data: { paymentMethodId: 'pm_primary', userId: 'alice' },
      });
      expect(response.status()).toBe(201);
    });
  });
});
```

The selected ID must exist in `blackbox.config.yaml`, and its declared kind must
match the selection. `system.sandbox(...)` creates a configuration group, not a
live shared resource. Blackbox resolves the catalog and creates a separate
Sandbox for each physical test attempt. Setup starts the selected Compose
services, installs the current Node activation adapter where configured, starts
the collector, verifies activation, waits for application readiness, and then
enters the native test callback.

The Sandbox declaration callback is synchronous. Use `suite.describe`,
`suite.test`, `suite.beforeEach`, and `suite.afterEach` inside it. Test and
per-test hook callbacks receive the normal Playwright fixtures plus `sandbox`,
`telemetry`, and `effects`. Continue to use `test.step(...)` for native steps.
Sandbox-scoped `beforeAll` and `afterAll` hooks are unavailable because there is
no group-level live Sandbox. Root Playwright `beforeAll` and `afterAll` hooks can
still perform setup unrelated to a Sandbox.

The fixture always requests Sandbox cleanup after the test body. Assertion
failure, timeout, skip, and interruption are retained as distinct cleanup
reasons. Setup failure also attempts cleanup before surfacing the error.

## Fixtures

- Playwright's configured `baseURL` remains unchanged. Build request and page
  URLs explicitly with `new URL(path, sandbox.entrypoint.url).href`.
- `sandbox` exposes read-only attempt, catalog, entrypoint, container, and
  artifact identity. Lifecycle control remains fixture-owned.
- `telemetry` exposes the attempt identity, live collector status, and raw
  retained session or trace reads.
- `effects` exposes the attempt identity and the contract-evaluation boundary.
  `expect(effects).toSatisfy(...)` evaluates an immutable contract against the
  attempt's completed stimulus activities. It retries only while retained
  activity telemetry is still inconclusive; elapsed time never turns missing
  evidence into a pass or a definite absence.
- `activities` records explicitly named `setup`, `stimulus`, and `inspection`
  actions. Each purpose supports `request`, `browser`, and custom `run` actions.
  Only stimuli feed the default `effects` selection, so fixture setup and state
  inspection cannot silently satisfy a behavior assertion.

Direct HTTP calls receive canonical W3C propagation without changing the native
Playwright request fixture:

```ts
const response = await activities.stimulus.request('create subscription', request, (scoped) =>
  scoped.post(new URL('/subscriptions', sandbox.entrypoint.url).href, {
    data: { userId: 'alice' },
  }),
);
```

Browser actions install a temporary route on the supplied page. The route adds
the activity context only to the Sandbox entrypoint origin and is removed when
the callback settles:

```ts
await activities.stimulus.browser('submit subscription form', page, async (scopedPage) => {
  await scopedPage.goto(new URL('/subscribe', sandbox.entrypoint.url).href);
  await scopedPage.getByRole('button', { name: 'Subscribe' }).click();
});
```

Configure the Playwright project with `use: { serviceWorkers: 'block' }` before
using scoped browser activities. Public Playwright routes do not reliably
intercept service-worker traffic or the follow-up hops of a redirect, so a
scoped browser action rejects any redirect response instead of losing activity
ownership. Start a new scoped action at the final URL when that behavior is part
of the test.

Only one Blackbox activity may own a given `Page` at a time. Nested or concurrent
scoped actions on the same page are rejected; independent pages can run separate
activities. Page work outside `activities.*.browser(...)` remains ordinary
native Playwright behavior and has no Blackbox activity propagation.

Use `activities.inspection.request(...)` for fixture state endpoints and other
authoritative reads. A successful state read remains a separate result; observed
attempt effects do not prove that state is durable.

## Validate the internal effects pipeline

Playwright owns activity selection, collector reads, effects handles and the
`toSatisfy` matcher. It delegates OTLP projection, contract compilation and
evaluation to the standalone [`@suites/blackbox-effects`](../effects/README.md)
package through its public entrypoint. The
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

The public activity fixture connects request and browser execution to the trusted
registry within each system/sandbox attempt. The internal factory remains outside
the authoring API. Shared sandboxes must not imply shared effects selections.
Published-release acceptance still requires the selected registry and version;
local packed candidates establish only candidate behavior.

## Execution reporting

Playwright's native reporter owns test progress, steps, colors, errors, and the
final summary. The fixture emits Sandbox setup and cleanup through Playwright's
public `test.step` API, so lifecycle duration and failure appear with the same
attempt as the test's business steps. The example above has this native title
hierarchy:

```text
system "subscription-system"
└─ sandbox "default"
   └─ health
      └─ reports ready
         ├─ Before Hooks
         │  └─ Fixture "Blackbox sandbox"
         │     └─ Start sandbox
         ├─ When health is requested
         └─ After Hooks
            └─ Fixture "Blackbox sandbox"
               └─ Clean up sandbox
```

The grouping does not change the existing `blackbox-progress`,
`blackbox-attempt`, or `blackbox-diagnostics` attachments. `Start sandbox`
completes only after acquisition, instrumentation, activation, and application
readiness pass. `Clean up sandbox` covers fixture-owned teardown. Playwright
records each step's duration and associates any setup or cleanup error with that
step. Native lifecycle reporting does not depend on the Blackbox reporter. Use
any native reporter alongside Blackbox; if no terminal reporter is configured,
Playwright adds its default one.

Fixtures attach sanitized `blackbox-progress` events and a final
`blackbox-attempt` JSON document to Playwright results, including failures.
Other Playwright reporters retain these attachments too. Startup observations
are bounded; the attempt document records how many were omitted.
The Blackbox reporter also adds a readable `blackbox-diagnostics` attachment.
Container health polling and detailed startup events stay in these attachments,
not the live console. Native reporters may display attachments for failed tests.

Every final `expect(effects).toSatisfy(...)` decision also attaches a
`blackbox-effects` JSON document, whether the assertion passes, fails, or stays
inconclusive. Open the test in Playwright's HTML report to inspect the attachment,
or read it from the result's `attachments` array when using Playwright's JSON
reporter. Repeated assertions have an attempt-local sequence number.

The document keeps the compiled contract beside its finding indexes, projected
effects and relations, and activity ownership. Admitted observations include
bounded excerpts with trace/span IDs, service, span kind/status, and supported
HTTP, RPC, database, cache, and messaging operation fields. Arbitrary attributes,
headers, bodies, SQL text, and span names are not attached. Protected environment
values and common credential forms are redacted before Playwright stores the
document.

`evidence.omitted` reports entries excluded by the attachment's display bounds,
and `display.truncatedStrings` reports shortened strings. These are presentation
limits only. They do not make capture complete or change the matcher result. Use
`projection.quality` and the contract assessment to understand admitted coverage
and uncertainty. When no observation was admitted, `evidence.kind` is
`not-admitted` and the assertion diagnostic explains why; negating the matcher
does not turn that inconclusive result into a pass.

The retained telemetry summary reads request/span counters from the lifecycle
record without loading raw trace fragments. Collector shutdown is reported from
its retained status. Neither a span count nor a
completed collector shutdown proves that a business workflow finished; the test
must await its completion boundary before asserting behavior. The internal effect
evaluator returns scope, witness, and uncertainty diagnostics in the
`blackbox-effects` attachment.

Accepted baselines, drivers, and shared worker sandboxes remain outside this
package's current surface.
