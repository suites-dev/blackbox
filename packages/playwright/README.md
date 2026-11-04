# Blackbox Playwright

`@suites/blackbox-playwright` groups native Playwright tests by a catalog system
and Sandbox configuration. Every physical test attempt, including a retry, runs
in a fresh Sandbox. Tests keep their native Playwright callbacks, hooks, steps,
reporters, and parallel scheduling.

Clients can wrap HTTP, messaging, database, or project-owned SDKs. Start with the
[Playwright guide](../../docs/playwright/README.md) for syntax and configuration,
or [clients and fixtures](../../docs/playwright/clients-and-fixtures.md) for shared
setup. The [testing guides](../../docs/guides/README.md) cover HTTP APIs,
asynchronous flows, and PostgreSQL and Redis seeding and state assertions.

## Prerequisites

This alpha is available in the source workspace. The package requires Node.js
22.15 or later and `@playwright/test` 1.61 or later within major version 1.
The examples assume the Blackbox workspace packages have been built, Docker is
available, and `blackbox.config.yaml` declares the selected system. Application
code imports directly from the adapter paths below.

## Use

Configure the catalog once in `playwright.config.ts`. The path is resolved
relative to that file. Test files then select a system or subsystem and declare
one or more named Sandbox configurations.

```ts
import { defineConfig } from '@suites/blackbox-playwright/config';

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
      },
    ],
    ['html', { open: 'never' }],
  ],
});
```

Then [write a native test](../../docs/playwright/README.md#add-clients-and-a-test).
Use `test.system.sandbox(selection, callback)` for one default-named configuration
or `test.system.sandbox(selection, { clients, environment }, callback)` to supply options:

```ts
import { test } from '@suites/blackbox-playwright';
import * as clients from './.blackbox/clients/index.js';

test.system.sandbox({ kind: 'subsystem', id: 'product-service' }, { clients }, (suite) => {
  suite.test('reads stored data', async ({ clients }) => {
    const value = await clients.redis.get('product:1');
    // value retains the Redis SDK return type.
  });
});
```

Export named `defineClient(...)` definitions from ordinary modules and pass the
module namespace as `{ clients }`. A normal export barrel can collect several
participant clients. Each handle retains its SDK type, readiness and disposal
lifecycle; import only the participants available in the selected sandbox.
Named configuration groups continue to use the nested API below.

Register your SDK clients in `system.sandbox(...)`; Blackbox readies them before
per-test hooks and disposes them during cleanup. The [async guide](../../docs/guides/testing-async-flows.md)
contains a complete Redis-to-PostgreSQL example.

## Migrate the flat fixture API

Replace
`test.use({ catalogEntry, blackboxEnvironment })` plus root `test(...)` calls with
`test.system(...)` and nested `system.sandbox(...)` groups, and pass `blackboxEnvironment` as the
Sandbox option `{ environment: blackboxEnvironment }`. Relative `request` and
`page` URLs behave differently: the native `request` fixture resolves relative
URLs against this attempt's HTTP Sandbox entrypoint, while `page` still uses the
project's configured `baseURL`. Absolute request URLs keep their native meaning.

The Sandbox `environment` is the Compose substitution environment for that group.
Progress and diagnostics redact the values of entries whose names mark a credential,
such as `TOKEN`, `PASSWORD`, `SECRET`, `KEY`, `AUTH` or `CREDENTIALS` segments.
Other values, such as a feature flag `TT_PRICE_STOPPED=1`, are shown as given.

A string passed to `test.system(...)` selects a catalog entry with kind `system`.
Use an object to select either kind explicitly:

```ts
test.system({ kind: 'subsystem', id: 'payment-mock' }, (system) => {
  system.sandbox('default', (suite) => {
    suite.test('accepts a payment', async ({ request }) => {
      const response = await request.post('/v1/payment_intents', {
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
per-test hook callbacks receive the normal Playwright fixtures plus `clients`,
`step`, `sandbox`, `telemetry`, and `effects`. Use the attempt-bound `step(...)`
fixture for native Playwright steps with local asynchronous context. Mark the
action whose effects matter with `step.stimulus(...)` and pass its W3C headers to
the client request. Step titles alone do not propagate tracing into the system.
Sandbox-scoped `beforeAll` and `afterAll` hooks are unavailable because there is
no group-level live Sandbox. Root Playwright `beforeAll` and `afterAll` hooks can
still perform setup unrelated to a Sandbox.

The fixture always requests Sandbox cleanup after the test body. Assertion
failure, timeout, skip, and interruption are retained as distinct cleanup
reasons. Setup failure also attempts cleanup before surfacing the error.

## Fixtures

- `clients` exposes the typed clients registered in the Sandbox declaration.
- `step` creates a native Playwright step with context bound to this attempt.
  `step.stimulus(...)` marks an owned action and supplies propagation headers.
  Ordinary `step(...)` remains useful for setup and inspection. A custom
  transport can pass the same headers at its entrypoint; Blackbox cannot inject
  them into arbitrary SDK calls.
- `request` remains Playwright's `APIRequestContext`; its relative HTTP URLs go
  to this attempt's Sandbox entrypoint. Absolute URLs and root hooks retain their
  native behavior. For non-HTTP entrypoints, supply an absolute HTTP URL or use
  the appropriate project-owned client.
- Playwright's configured `baseURL` remains unchanged for `page`. Resolve page
  URLs against the Sandbox entrypoint explicitly when needed.
- `sandbox` exposes read-only attempt, catalog, entrypoint, container, and
  artifact identity. Lifecycle control remains fixture-owned.
- `telemetry` exposes the attempt identity, live collector status, and raw
  retained session or trace reads.
- `effects` exposes the attempt identity and evaluates immutable contracts
  against OTLP observations owned by completed stimulus steps. Use
  `expect(effects).toSatisfy(...)`. Missing or incomplete observation remains
  inconclusive, including under negation; an observed operation does not prove
  durable state.

## Execution reporting

Playwright's native reporter owns test progress, steps, colors, errors, and the
final summary. The async guide produces this title hierarchy:

```text
system "job-system"
└─ sandbox "default"
   └─ processes a queued job
      ├─ Queue a job
      └─ Wait for completion
```

The grouping does not change the existing `blackbox-progress`,
`blackbox-attempt`, or `blackbox-diagnostics` attachments. Blackbox also adds two
short messages through the test's captured stdout, so Playwright associates them
with the right parallel attempt:

```text
Blackbox: sandbox ready for system "job-system"
... native Playwright test and step output ...
Blackbox: sandbox cleaned up for system "job-system"
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

Playwright clears `test-results/` and its HTML report on every run. To keep
attempt evidence across runs, enable retention in the Playwright configuration:

```ts
import { defineConfig } from '@suites/blackbox-playwright/config';

const use = {
  trace: 'retain-on-failure' as const,
  blackboxRetainAttempts: true,
};

export default defineConfig({
  blackboxConfigFile: './blackbox.config.yaml',
  use,
});
```

After cleanup, each attempt is copied to
`.blackbox/experiments/<sandboxId>/` (a `playwright-<uuid>` directory) beside
`blackbox.config.yaml`: `attempt.json` holds the final attempt document and
`sandbox/` the sandbox record and retained telemetry. Retention is off by default,
never overwrites an existing directory, and fails the attempt if it cannot write.
`capsule report` does not read these directories yet.

Retention preserves raw evidence. Open `attempt.json` to inspect the test identity
and recorded events; use the files under `sandbox/` for the sandbox lifecycle and
telemetry. There is no saved-attempt browser or comparison command, and this
option does not archive Playwright's HTML report.

The retained telemetry summary reads request/span counters from the lifecycle
record without loading raw trace fragments. Collector shutdown is reported from
its retained status. Neither a span count nor a
completed collector shutdown proves that a business workflow finished; the test
must await its completion boundary before asserting behavior. Effect contract
diagnostics will be added with the effect evaluator.

## Behavioral history

Each attempt also attaches three documents, on by default (`blackboxFinalSnapshot: false` turns
this off): `blackbox-effects-final` (the attempt's effects after cleanup, also when the test
failed), `blackbox-envelope` (the attempt's identity, source revision, configuration fingerprints,
stimulus fingerprint, reported state and evidence digests) and `blackbox-receipt` (how the attempt
ended, including attempts that never got a sandbox, which have no envelope). `EffectsRecord` v0
and the assertion attachments are unchanged. The Blackbox reporter sets `BLACKBOX_INVOCATION_ID`
once per Playwright invocation so retries can be grouped.

Declare which behavior a test exercises, and optionally report authoritative state, from the test:

```ts
test.info().annotations.push({ type: 'bb:behavior', description: 'subscription.payment' });
test.info().annotations.push({
  type: 'bb:state',
  description: JSON.stringify({
    subject: 'payment-intents',
    source: 'payment service',
    identities: ['pi_1'],
  }),
});
```

Without `bb:behavior` the id is derived from the system, project and test titles (not the file).
Reported state is the test's statement; identities are stored as digests. Only the first
`bb:state` report per subject is kept; later or malformed ones are counted and make a comparison
that includes the attempt unresolved.

Store and query attempts with the `./history` entry point. Add the JSON reporter so attachments
are in the results file:

```ts
import { BehaviorHistory, ingestPlaywrightResults } from '@suites/blackbox-playwright/history';

const history = await BehaviorHistory.open('.blackbox/history');
await ingestPlaywrightResults(history, 'test-results/results.json'); // idempotent

const [behavior] = await history.behaviors();
const runs = await history.behaviorHistory(behavior.behaviorId, { followAliases: false });
const executions = runs.flatMap(({ envelopeId }) => (envelopeId === null ? [] : [envelopeId]));

const delta = await history.compare(executions[0], executions[executions.length - 1], {
  claims: [
    {
      id: 'one-payment',
      n: 1,
      selector: {
        kind: 'http',
        actor: 'payment',
        side: 'server',
        operation: 'POST',
        target: 'unknown',
      },
      stateSubject: 'payment-intents',
    },
  ],
  record: true,
});
// delta.outcome: invalid | inconclusive | no-observed-difference | observed-difference
// delta.drift (what changed) is separate from delta.verification.claims (limits that held or not)

const checks = await history.verifyEvidence(executions[0], 'test-results/<attempt output dir>');
const findings = await history.findings(behavior.behaviorId, { followAliases: false });
```

`behaviors()`, `behaviorHistory()` (chronological, marks revision changes and attempts without
evidence), `execution()` (envelope, snapshot, receipts, evidence status), `compare()`, `findings()`,
`recordAlias()`, `rebuildIndex()` and `verifyStore()` are the rest of the surface.

Storage semantics:

- The directory holds `objects/<kind>/<xx>/<sha256>` (envelope, blob, receipt, alias, delta), `tmp/`
  and a derived `index/index.json`. Objects are written once (temporary file, `fsync`, hard link);
  writing the same record again is a no-op, and different bytes under one id is a `ConflictError`.
- There is no database and no shared mutable head, so independent processes can write the same
  directory. A write interrupted by a crash leaves a `tmp/*.partial` file that is never read.
- The index is a cache built from the objects and can be deleted at any time. Records that fail
  verification, or have a valid digest and the wrong shape, are listed by `verifyStore()` and never
  served. Every read re-verifies the record against the identity it is stored under.
- `compare()` checks comparability first. Spans alone never refute a limit; reported state does.
  Nothing in the history marks an observation as accepted.
- Aliases are recorded claims that two behavior ids are the same. Ambiguity and cycles are
  reported; nothing is inferred from names or rewritten.

Limitations:

- A digest shows a record is the one that was written, not who wrote it. Treat the directory as
  trusted local storage with owner-only access.
- A worker killed before teardown leaves no receipt or envelope. An attempt that fails before the
  test body runs can only be attributed to a declared behavior through its derived id.
- State identities, request bodies and non-secret environment values are stored as unsalted digests,
  so a low-entropy value can be guessed from its digest; request paths and up to 50 changed file
  names are stored in clear. Credential-named variables and headers, and URLs with credentials,
  are recorded by name only. Do not put secrets in innocuously named variables or in request paths.
- Evidence verification needs the original output directory and refuses locators that leave it.
  Raw collector fragments are referenced, not copied.
- Captures are never proven complete, so healthy limits read "not refuted", and "no observed
  difference" is not equivalence. The index is rebuilt in full after a write; there is no merge,
  retention or sync.

Effect projection, accepted baselines, drivers, and shared worker
sandboxes are intentionally outside this package's current surface.
