import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  assertSameTree,
  execTitle,
  featureError,
  featureGolden,
  goldenDifference,
  incompleteFeatureGolden,
  retentionTitle,
  snapshotTree,
  verifyFinishedSandbox,
  verifyRetainedAttempt,
  verifyRunReport,
  writeFeatureComparison,
} from './playwright-features-proof.mjs';

function reportFixture(mode = 'retained-second') {
  const document = {
    identity: {
      kind: 'acquired',
      sandboxId: 'sandbox-one',
      executionId: 'sandbox-one',
      sessionId: 'session-one',
    },
    events: [{ phase: 'teardown', status: 'completed' }],
  };
  const attempt = {
    status: mode === 'write-failure' ? 'failed' : 'passed',
    errors:
      mode === 'write-failure'
        ? [{ message: 'Blackbox could not retain the attempt in /owned' }]
        : [],
    attachments: [
      { name: 'blackbox-attempt', body: Buffer.from(JSON.stringify(document)).toString('base64') },
    ],
  };
  return {
    errors: [],
    suites: [{ specs: [{ title: retentionTitle, tests: [{ results: [attempt] }] }] }],
  };
}

test('snapshot safely tracks prototype-sensitive file names', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'blackbox-feature-names-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const names = ['__proto__', 'constructor', 'toString'];
  for (const name of names) await writeFile(join(root, name), 'retained evidence');
  const snapshot = await snapshotTree(root);
  assert.equal(Object.getPrototypeOf(snapshot), Object.prototype);
  assert.deepEqual(Object.keys(snapshot).sort(), names.sort());
  for (const name of names) {
    assert(Object.hasOwn(snapshot, name));
    assert.equal(snapshot[name].bytes, Buffer.byteLength('retained evidence'));
    assert.match(snapshot[name].sha256, /^[a-f0-9]{64}$/u);
  }
  assertSameTree(snapshot, JSON.parse(JSON.stringify(snapshot)), 'Snapshot JSON lost filenames');
});

test('feature discovery rejects omitted tests, unexpected retries and skipped execution', () => {
  const report = reportFixture();
  verifyRunReport(report, 'retained-second', 0);
  assert.throws(() => verifyRunReport(report, 'retained-first', 0), /Feature discovery drift/u);
  const results = report.suites[0].specs[0].tests[0].results;
  results.push(structuredClone(results[0]));
  assert.throws(() => verifyRunReport(report, 'retained-second', 0), /once without retries/u);
  results.pop();
  results[0].status = 'skipped';
  assert.throws(
    () => verifyRunReport(report, 'retained-second', 0),
    /Unexpected feature attempt status/u,
  );
});

test('write-failure proof rejects swallowed retention errors and unrelated test failures', () => {
  const report = reportFixture('write-failure');
  verifyRunReport(report, 'write-failure', 1);
  assert.throws(() => verifyRunReport(report, 'write-failure', 0), /process exit/u);
  report.suites[0].specs[0].tests[0].results[0].errors[0].message = 'Sandbox failed to start';
  assert.throws(() => verifyRunReport(report, 'write-failure', 1), /could not retain/u);
});

async function artifactFixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'blackbox-feature-proof-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = join(root, 'source');
  const destination = join(root, 'retained');
  const collector = join(source, 'sandbox-one.compose', 'collector', 'session-one', 'sandbox-one');
  await mkdir(join(collector, 'fragments'), { recursive: true });
  await writeFile(
    join(source, 'sandbox-one.json'),
    JSON.stringify({
      schemaVersion: 1,
      sandboxId: 'sandbox-one',
      projectName: 'owned-one',
      composeFiles: [],
      state: 'completed',
      cleanup: 'complete',
      stopReason: 'completed',
    }),
  );
  await writeFile(
    join(collector, 'collector-lifecycle.json'),
    JSON.stringify({
      sessionId: 'session-one',
      executionId: 'sandbox-one',
      runs: [{ receiver: 'stopped', shutdown: 'complete' }],
      telemetry: { acceptedRequests: 1, acceptedSpans: 1 },
    }),
  );
  const fragmentPath = join(collector, 'fragments', '000000000001.json');
  await writeFile(
    fragmentPath,
    JSON.stringify({
      sessionId: 'session-one',
      executionId: 'sandbox-one',
      rawJson: JSON.stringify({
        resourceSpans: [{ scopeSpans: [{ spans: [{ traceId: 'trace-owned' }] }] }],
      }),
    }),
  );
  const receipt = {
    sandboxId: 'sandbox-one',
    executionId: 'sandbox-one',
    sessionId: 'session-one',
    traceId: 'trace-owned',
    artifactDirectory: source,
  };
  const document = JSON.stringify({ identity: receipt, events: [] });
  await cp(source, join(destination, 'sandbox'), { recursive: true });
  await writeFile(join(destination, 'attempt.json'), document);
  return { root, source, destination, collector, fragmentPath, receipt, document };
}

test('retention proof compares complete metadata and telemetry bytes, then detects rerun corruption', async (t) => {
  const fixture = await artifactFixture(t);
  const verified = await verifyRetainedAttempt(
    fixture.destination,
    fixture.receipt,
    fixture.document,
  );
  assert.equal(verified.fragmentCount, 1);
  const copiedRecord = join(fixture.destination, 'sandbox', 'sandbox-one.json');
  await writeFile(copiedRecord, '{}');
  await assert.rejects(
    verifyRetainedAttempt(fixture.destination, fixture.receipt, fixture.document),
    /copy every source file/u,
  );
  assert.throws(
    () =>
      assertSameTree(
        { file: { bytes: 1, sha256: 'new' } },
        { file: { bytes: 1, sha256: 'old' } },
        'prior attempt changed',
      ),
    /prior attempt changed/u,
  );
  await assert.rejects(
    async () =>
      assertSameTree(
        await snapshotTree(fixture.destination),
        verified.snapshot,
        'rerun changed retained bytes',
      ),
    /rerun changed retained bytes/u,
  );
});

test('retention proof rejects lost fragments, foreign ownership and missing activity telemetry', async (t) => {
  const fixture = await artifactFixture(t);
  const fragment = JSON.parse(await readFile(fixture.fragmentPath, 'utf8'));
  fragment.sessionId = 'foreign-session';
  await writeFile(fixture.fragmentPath, JSON.stringify(fragment));
  await assert.rejects(verifyFinishedSandbox(fixture.source, fixture.receipt), /Foreign session/u);
  fragment.sessionId = 'session-one';
  fragment.rawJson = JSON.stringify({
    resourceSpans: [{ scopeSpans: [{ spans: [{ traceId: 'foreign-trace' }] }] }],
  });
  await writeFile(fixture.fragmentPath, JSON.stringify(fragment));
  await assert.rejects(
    verifyFinishedSandbox(fixture.source, fixture.receipt),
    /lacks the test activity trace/u,
  );
  await rm(fixture.fragmentPath);
  await assert.rejects(
    verifyFinishedSandbox(fixture.source, fixture.receipt),
    /telemetry is empty/u,
  );
});

test('retention proof rejects snapshots taken before collector drain or sandbox cleanup', async (t) => {
  const fixture = await artifactFixture(t);
  const lifecyclePath = join(fixture.collector, 'collector-lifecycle.json');
  const lifecycle = JSON.parse(await readFile(lifecyclePath, 'utf8'));
  lifecycle.runs[0].receiver = 'running';
  await writeFile(lifecyclePath, JSON.stringify(lifecycle));
  await assert.rejects(
    verifyFinishedSandbox(fixture.source, fixture.receipt),
    /drained and stopped/u,
  );
  const recordPath = join(fixture.source, 'sandbox-one.json');
  const record = JSON.parse(await readFile(recordPath, 'utf8'));
  record.cleanup = 'pending';
  await writeFile(recordPath, JSON.stringify(record));
  await assert.rejects(
    verifyFinishedSandbox(fixture.source, fixture.receipt),
    /cleaned before retention/u,
  );
});

test('feature golden preserves test counts, command failures and retention outcomes', () => {
  const runs = ['retained-first', 'retained-second', 'default-off', 'write-failure'].map(
    (mode, index) => ({
      mode,
      specs: index === 0 ? 2 : 1,
      exitCode: index === 3 ? 1 : 0,
      retained: index < 2 ? Array(index === 0 ? 2 : 1).fill({}) : [],
      receipts: [],
    }),
  );
  runs[0].receipts.push({
    activities: [{ exitCode: 0 }, { exitCode: 23 }],
    traceLinks: { rootSpanId: 'root', clientSpanId: 'client', serverSpanId: 'server' },
  });
  const proof = {
    runs,
    outputClearedBetweenRuns: true,
    retainedBytesSurvived: true,
    defaultOffUnchanged: true,
    writeFailurePreserved: true,
  };
  const recovery = { recoveries: Array(5).fill({}) };
  const golden = featureGolden(proof, recovery);
  assert.equal(goldenDifference(golden, golden), '');
  assert.match(golden, /exit=23 events=started,failed/u);
  runs[3].exitCode = 0;
  assert.match(
    goldenDifference(featureGolden(proof, recovery), golden),
    /- write-failure: tests=1 exit=1/u,
  );
  assert.match(
    goldenDifference(featureGolden(proof, recovery), golden),
    /\+ write-failure: tests=1 exit=0/u,
  );
  const first = reportFixture();
  first.suites[0].specs.push({ ...first.suites[0].specs[0], title: execTitle });
  verifyRunReport(first, 'retained-first', 0);
});

test('startup and semantic failures still persist expected, incomplete actual and golden diff', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'blackbox-feature-failure-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const expected = 'Playwright packed-consumer setup and retention\nverified success\n';
  for (const observed of [[], [{ mode: 'retained-first', exitCode: 1, status: 'failed' }]]) {
    const actual = incompleteFeatureGolden(
      observed,
      { recoveries: [] },
      new Error('fixture failed'),
    );
    const difference = await writeFeatureComparison(root, expected, actual);
    assert.equal(await readFile(join(root, 'acceptance.expected.txt'), 'utf8'), expected);
    assert.equal(await readFile(join(root, 'acceptance.actual.txt'), 'utf8'), actual);
    assert.match(actual, /INCOMPLETE: feature acceptance failed/u);
    assert.equal(await readFile(join(root, 'golden-diff.txt'), 'utf8'), difference);
    assert.match(difference, /\+ INCOMPLETE:/u);
    await assert.rejects(readFile(join(root, 'receipt.json'), 'utf8'), { code: 'ENOENT' });
  }
});

test('failure evidence preserves aggregate errors, cause stacks and circular causes', () => {
  const cause = new Error('filesystem failure');
  const command = new Error('command failed', { cause });
  const error = new AggregateError([command, new Error('cleanup failed')], 'journey failed');
  const serialized = JSON.parse(JSON.stringify(featureError(error)));
  assert.match(serialized.stack, /AggregateError: journey failed/u);
  assert.match(serialized.errors[0].stack, /Error: command failed/u);
  assert.match(serialized.errors[0].cause.stack, /Error: filesystem failure/u);
  assert.match(serialized.errors[1].stack, /Error: cleanup failed/u);
  cause.cause = cause;
  assert.equal(featureError(cause).cause.message, '[circular error reference]');
});
