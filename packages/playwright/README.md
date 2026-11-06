# Blackbox Playwright

`@suites/blackbox-playwright` groups native Playwright tests by a catalog system
and Sandbox configuration. Every selected physical test attempt, including a retry,
runs in a fresh Sandbox. Tests keep their native Playwright callbacks, hooks, steps,
reporters, and parallel scheduling.

Clients can wrap HTTP, messaging, database, or project-owned SDKs. The
[consumer tests](../../e2e/tests/playwright/) show selected systems, client setup,
and response and state assertions.

## Prerequisites

Install the adapter and Playwright in your project:

```sh
pnpm add -D @suites/blackbox-playwright@alpha @playwright/test
```

The package requires Node.js 22.15 or later and Playwright 1.61 or later within
major version 1. The examples assume Docker is available and
`blackbox.config.yaml` declares the selected system.

## Use

Configure the catalog once in `playwright.config.ts`. The path is resolved
relative to that file. Test files select a system or subsystem with the native `test.use` option.
Group scenarios with ordinary `test.describe` blocks.

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

Select a catalog entry and write a native test:

```ts
import { test, expect } from '@suites/blackbox-playwright';

test.describe('Rule: valid payments are accepted', { tag: '@acceptance' }, () => {
  test.use({ blackbox: { system: 'payment-system' } });

  test('Scenario: a valid method creates an intent', async ({ request }) => {
    const response = await request.post('/v1/payment_intents', {
      data: { paymentMethodId: 'pm_primary', userId: 'alice' },
    });
    expect(response.status()).toBe(201);
  });
});
```

A string selects the ID using its kind in the catalog. To require a particular
kind, use `system: { kind: 'subsystem', id: 'payment-mock' }`. The ID must exist,
and an explicit kind must agree with the catalog. Selection creates a fresh
Sandbox for every physical test attempt, including retries, even if the test
callback requests no Blackbox fixtures.

The exported `test` is a native Playwright `TestType`. Use `test.extend`,
`mergeTests`, nested `test.describe`, tags, hooks, retries, and parallel scheduling
normally. An unselected test runs as ordinary Playwright; requesting `clients`,
`step`, `sandbox`, `telemetry`, or `effects` without selecting a system fails.

## Register typed clients

Export named `defineClient(...)` definitions from ordinary modules and register
only the participants available in this system:

```ts
import { test } from '@suites/blackbox-playwright';
import * as clients from './.blackbox/clients/index.js';

test.use({ blackbox: { system: 'product-service', clients } });

test('reads stored data', async ({ clients }) => {
  const value = await clients.redis.get('product:1');
  // value retains the Redis SDK return type.
});
```

Declare your project client types once in the registration module. For example,
if `redis.ts` exports a `defineClient(...)` definition:

```ts
import type { RegisteredClients } from '@suites/blackbox-playwright';
import type { redis } from './redis.js';

export { redis } from './redis.js';

type ProjectClients = RegisteredClients<{ redis: typeof redis }>;

declare module '@suites/blackbox-playwright' {
  interface BlackboxClients {
    redis: ProjectClients['redis'];
  }
}
```

Include this module in the project's TypeScript compilation. Types describe the
available handles; each selected suite still supplies its runtime registrations.
Accessing an unregistered client throws a clear configuration error. Blackbox
readies registered clients before per-test hooks and disposes them during cleanup.
See the [consumer client definitions](../../e2e/.blackbox/clients/) for examples.

## Configure suites and migrate existing tests

Attempt options live under `blackbox`: `system`, `clients`, `environment`,
`retainAttempts` (default `false`), and `finalSnapshot` (default `true`). Native
Playwright inheritance replaces the whole `blackbox` object at a narrower scope;
it does not deep-merge its properties. Reuse shared settings explicitly:

```ts
const shared = { clients, retainAttempts: true };

test.describe('payment service', () => {
  test.use({ blackbox: { ...shared, system: 'payment-system' } });
});
```

Replace the former `test.system` and sandbox declaration facade with
`test.describe`, `test.use({ blackbox: { system, clients, environment } })`, and
native `test(...)` calls. Replace `suite.beforeEach` and `suite.afterEach` with
native hooks. Flat `catalogEntry`, `blackboxEnvironment`, `blackboxClients`,
`blackboxRetainAttempts`, and `blackboxFinalSnapshot` options are removed.
Changing describe titles also changes native test IDs and title-derived behavior
IDs. Keep explicit `bb:behavior` annotations where a stable behavior identity is
needed across this authoring migration.

`environment` supplies Compose substitutions for the selected system. Progress
and diagnostics redact credential-named values such as `TOKEN`, `PASSWORD`,
`SECRET`, `KEY`, `AUTH`, and `CREDENTIALS`. Other values, such as a feature flag
`TT_PRICE_STOPPED=1`, are shown as given.

The native `request` fixture resolves relative URLs against this attempt's HTTP
Sandbox entrypoint. Absolute URLs retain their native meaning. Playwright's
configured `baseURL` remains unchanged for `page`; resolve browser URLs against
the Sandbox entrypoint explicitly when needed.

Setup starts selected Compose services, installs configured Node instrumentation,
starts the collector, verifies activation, and waits for application readiness.
Test and per-test hook callbacks then receive normal Playwright fixtures plus
`clients`, `step`, `sandbox`, `telemetry`, and `effects`. Use the attempt-bound
`step(...)` for native steps with local asynchronous context. Mark an owned action
with `step.stimulus(...)` and pass its W3C headers to the client request. Step
titles alone do not propagate tracing into the system.

Native `beforeAll` and `afterAll` hooks can perform setup unrelated to a Sandbox.
They cannot acquire attempt-owned Blackbox fixtures because each test owns a
separate Sandbox. Use `beforeEach` and `afterEach` for Sandbox setup and inspection.

The fixture always requests Sandbox cleanup after the test body. Assertion
failure, timeout, skip, and interruption are retained as distinct cleanup
reasons. Setup failure also attempts cleanup before surfacing the error.

## Fixtures

- `clients` exposes the typed clients registered in `blackbox.clients`.
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

## Account for assertions in a callback

`assertionScope(callback)` preserves the callback's return value and reports
logical assertion outcomes. Use Blackbox's exported `test` and `expect`:

```ts
import { assertionScope, expect, test } from '@suites/blackbox-playwright';

test.use({ blackbox: { system: 'payment-system' } });

test('checks the returned payment', async ({ request }) => {
  const response = await request.post('/v1/payment_intents', {
    data: { paymentMethodId: 'pm_primary', userId: 'alice' },
  });
  const { value: intent, accounting } = await assertionScope(async () => {
    expect(response.status()).toBe(201);
    const body = await response.json() as { status: string };
    expect(body.status).toBe('succeeded');
    return body;
  });
  // intent is the callback's result; accounting.total and accounting.passed are 2.
});
```

Accounting contains `total`, `passed`, `failed`, `pending`, and `unconsumed`.
An empty callback, a swallowed assertion failure, or a soft failure cannot pass
the scope. Misuse rejects with `AssertionScopeError`, whose `code` and
`accounting` describe the reason. An error thrown by the callback still propagates
as its original error. Counts establish assertion execution and outcomes, not the
adequacy of the business contract.
Custom matcher implementations remain trusted: accounting follows their terminal
native verdict and does not verify the quality of their internal comparisons.

Await every asynchronous matcher, or return it directly from the callback.
Starting a matcher with `void`, leaving it pending, or returning it inside an
unawaited object does not consume it. Nested scopes aggregate logical assertions
once; concurrent scopes keep their accounting separate. Polling and `toPass`
account for the terminal assertion, not their intermediate retry samples.
A caught Blackbox assertion failure in the final polling sample still fails the
scope, even when the sampled value satisfies the outer matcher.
`expect(async () => {}).toPass()` still counts as one native assertion; accounting
does not establish that its callback contains a useful oracle.
Native snapshot creation or update follows its native outcome; a counted pass
does not establish that an existing baseline was compared or reviewed.

This scoped feature supports **Playwright 1.64.1 only** and checks the native
completion-hook shape before use. Other versions or raw `@playwright/test`
expectations inside a scope are unsupported. Use Blackbox's exported `expect`,
including its `extend` and `configure` variants. Ordinary assertions outside a
scope retain the package's existing Playwright peer support.

Scopes belong to physical test attempts and need no selected Sandbox by
themselves. They work in test bodies and per-test hooks from Blackbox's native
`test`; they reject outside an active attempt and in `beforeAll`/`afterAll`.
The primitive does not add preconditions, state observers, or a durable execution
evidence schema.

## Execution reporting

Playwright's native reporter owns test progress, steps, colors, errors, and the
final summary. Describe titles and native steps determine the hierarchy:

```text
Rule: queued jobs complete
└─ Scenario: processes a queued job
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
  blackbox: { system: 'payment-system', retainAttempts: true },
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

Each attempt also attaches three documents, on by default (`blackbox.finalSnapshot: false` turns
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
