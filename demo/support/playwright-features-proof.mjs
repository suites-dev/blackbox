import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstat, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

export const retentionTitle = 'Scenario: finished attempts retain their real telemetry';
export const execTitle =
  'Scenario: container setup seeds state and produces linked activity evidence';

export async function filesUnder(root) {
  const files = [];
  async function visit(directory) {
    for (const name of (await readdir(directory)).sort()) {
      const path = join(directory, name);
      const information = await lstat(path);
      if (information.isDirectory()) await visit(path);
      else {
        assert(information.isFile(), `Unsupported evidence entry: ${path}`);
        files.push(path);
      }
    }
  }
  await visit(root);
  return files;
}

export async function snapshotTree(root) {
  const snapshot = {};
  for (const path of await filesUnder(root)) {
    const bytes = await readFile(path);
    snapshot[relative(root, path)] = {
      bytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    };
  }
  assert(Object.keys(snapshot).length > 0, `Empty artifact tree: ${root}`);
  return snapshot;
}

export function assertSameTree(actual, expected, message) {
  assert.deepEqual(actual, expected, message);
}

function collectSpecs(suite) {
  return [...(suite.specs ?? []), ...(suite.suites ?? []).flatMap(collectSpecs)];
}

export function verifyRunReport(report, mode, exitCode) {
  const specs = (report.suites ?? []).flatMap(collectSpecs);
  const expected = mode === 'retained-first' ? [execTitle, retentionTitle] : [retentionTitle];
  assert.deepEqual(
    specs.map(({ title }) => title).sort(),
    expected.sort(),
    'Feature discovery drift',
  );
  assert.deepEqual(report.errors ?? [], [], 'Unexpected Playwright global errors');
  const attempts = specs.flatMap((spec) => spec.tests.flatMap((test) => test.results));
  assert.equal(
    attempts.length,
    expected.length,
    'Feature attempts must execute once without retries',
  );
  const expectedStatus = mode === 'write-failure' ? 'failed' : 'passed';
  assert.equal(exitCode, mode === 'write-failure' ? 1 : 0, 'Unexpected Playwright process exit');
  for (const attempt of attempts) {
    assert.equal(attempt.status, expectedStatus, 'Unexpected feature attempt status');
    if (mode === 'write-failure') {
      assert.match(JSON.stringify(attempt.errors), /Blackbox could not retain the attempt in /u);
    } else assert.deepEqual(attempt.errors, [], 'Passing feature attempt had errors');
    const attachments = attempt.attachments.filter(({ name }) => name === 'blackbox-attempt');
    assert.equal(attachments.length, 1, 'Missing final Blackbox attempt attachment');
    const document = JSON.parse(Buffer.from(attachments[0].body, 'base64').toString('utf8'));
    assert.equal(document.identity.kind, 'acquired');
    assert(
      document.events.some(({ phase, status }) => phase === 'teardown' && status === 'completed'),
      'Missing successful sandbox cleanup event',
    );
  }
  return attempts;
}

export async function sandboxRecords(root) {
  const records = [];
  for (const path of await filesUnder(root)) {
    if (!path.endsWith('.json')) continue;
    const value = JSON.parse(await readFile(path, 'utf8'));
    if (
      value?.schemaVersion === 1 &&
      typeof value.sandboxId === 'string' &&
      typeof value.projectName === 'string' &&
      Array.isArray(value.composeFiles)
    ) {
      records.push({ path, value });
    }
  }
  return records;
}

export async function verifyFinishedSandbox(directory, receipt) {
  const record = JSON.parse(await readFile(join(directory, `${receipt.sandboxId}.json`), 'utf8'));
  assert.equal(record.sandboxId, receipt.sandboxId);
  assert.equal(record.state, 'completed', 'Sandbox record must be finalized before retention');
  assert.equal(record.cleanup, 'complete', 'Sandbox resources must be cleaned before retention');
  assert.equal(record.stopReason, 'completed');
  const collector = join(
    directory,
    `${receipt.executionId}.compose`,
    'collector',
    receipt.sessionId,
    receipt.executionId,
  );
  const lifecycle = JSON.parse(await readFile(join(collector, 'collector-lifecycle.json'), 'utf8'));
  assert.equal(lifecycle.sessionId, receipt.sessionId);
  assert.equal(lifecycle.executionId, receipt.executionId);
  assert(lifecycle.runs.length > 0, 'No real collector lifecycle');
  assert(
    lifecycle.runs.every(
      ({ receiver, shutdown }) => receiver === 'stopped' && shutdown === 'complete',
    ),
    'Retained collector must have drained and stopped',
  );
  const fragmentFiles = await filesUnder(join(collector, 'fragments'));
  assert(fragmentFiles.length > 0, 'Retained telemetry is empty');
  const spans = [];
  for (const path of fragmentFiles) {
    const fragment = JSON.parse(await readFile(path, 'utf8'));
    assert.equal(fragment.sessionId, receipt.sessionId, 'Foreign session in retained telemetry');
    assert.equal(
      fragment.executionId,
      receipt.executionId,
      'Foreign execution in retained telemetry',
    );
    const request = JSON.parse(fragment.rawJson);
    spans.push(
      ...request.resourceSpans.flatMap(({ scopeSpans }) =>
        scopeSpans.flatMap(({ spans: children }) => children),
      ),
    );
  }
  assert.equal(
    fragmentFiles.length,
    lifecycle.telemetry.acceptedRequests,
    'Retained artifact lost accepted telemetry fragments',
  );
  assert.equal(
    spans.length,
    lifecycle.telemetry.acceptedSpans,
    'Retained artifact lost accepted telemetry spans',
  );
  const traces = receipt.activities?.map(({ traceId }) => traceId) ?? [receipt.traceId];
  assert(
    traces.length > 0 && traces.every((traceId) => spans.some((span) => span.traceId === traceId)),
    'Retained artifact lacks the test activity trace',
  );
  if (receipt.traceLinks !== undefined) {
    const { rootSpanId, clientSpanId, serverSpanId } = receipt.traceLinks;
    const root = spans.find(({ spanId }) => spanId === rootSpanId);
    const client = spans.find(({ spanId }) => spanId === clientSpanId);
    const server = spans.find(({ spanId }) => spanId === serverSpanId);
    assert(
      root !== undefined && client !== undefined && server !== undefined,
      'Retained activity is missing the root/client/server trace chain',
    );
    assert.equal(client.parentSpanId, root.spanId, 'Retained client lost its activity parent');
    assert.equal(server.parentSpanId, client.spanId, 'Retained server lost its HTTP client parent');
    assert.equal(client.traceId, root.traceId);
    assert.equal(server.traceId, root.traceId);
  }
  return { record, fragmentCount: fragmentFiles.length, spanCount: spans.length };
}

export async function verifyRetainedAttempt(directory, receipt, attachedDocument) {
  const documentText = await readFile(join(directory, 'attempt.json'), 'utf8');
  assert.equal(documentText, attachedDocument, 'Retained report differs from the final attachment');
  const document = JSON.parse(documentText);
  assert.equal(document.identity.sandboxId, receipt.sandboxId);
  assert.equal(document.identity.executionId, receipt.executionId);
  assert.equal(document.identity.sessionId, receipt.sessionId);
  const source = await snapshotTree(receipt.artifactDirectory);
  assertSameTree(
    await snapshotTree(join(directory, 'sandbox')),
    source,
    'Retained sandbox must copy every source file byte-for-byte',
  );
  const evidence = await verifyFinishedSandbox(join(directory, 'sandbox'), receipt);
  for (const activity of receipt.activities ?? []) {
    for (const status of ['started', activity.exitCode === 0 ? 'completed' : 'failed']) {
      assert.equal(
        document.events.filter(
          (event) =>
            event.phase === 'activity' &&
            event.status === status &&
            event.detail.startsWith(`${activity.activityId};`),
        ).length,
        1,
        `Missing retained ${status} event for ${activity.activityId}`,
      );
    }
  }
  if (receipt.secret !== undefined) {
    assert(!documentText.includes(receipt.secret), 'Retained report leaked a command argument');
  }
  return { ...evidence, snapshot: await snapshotTree(directory) };
}

/** IDs, paths, timestamps and telemetry batching are kept in the raw receipts. */
export function featureGolden(proof, recovery) {
  const lines = ['Playwright packed-consumer setup and retention'];
  for (const run of proof.runs) {
    lines.push(
      `${run.mode}: tests=${run.specs} exit=${run.exitCode} retained=${run.retained.length}`,
    );
  }
  const exec = proof.runs[0].receipts.find((receipt) => Array.isArray(receipt.activities));
  assert(exec !== undefined, 'Golden requires observed setup activities');
  for (const activity of exec.activities) {
    lines.push(
      `setup activity: exit=${activity.exitCode} events=started,${activity.exitCode === 0 ? 'completed' : 'failed'}`,
    );
  }
  assert(exec.traceLinks !== undefined, 'Golden requires observed root/client/server links');
  lines.push('setup trace parents: activity-root -> http-client -> payment-server');
  lines.push(
    `normal output cleared by second run: ${proof.outputClearedBetweenRuns}`,
    `retained reports, sandbox metadata and telemetry preserved byte-for-byte: ${proof.retainedBytesSurvived}`,
    `default option leaves retained tree unchanged: ${proof.defaultOffUnchanged}`,
    `collision fails teardown and preserves existing evidence: ${proof.writeFailurePreserved}`,
    `owned sandboxes recovered without Docker resources: ${recovery.recoveries.length}`,
  );
  return `${lines.join('\n')}\n`;
}

export function goldenDifference(actual, expected) {
  if (actual === expected) return '';
  const actualLines = actual.trimEnd().split('\n');
  const expectedLines = expected.trimEnd().split('\n');
  return (
    [
      ...new Set([
        ...actualLines.map((_, index) => index),
        ...expectedLines.map((_, index) => index),
      ]),
    ]
      .filter((index) => actualLines[index] !== expectedLines[index])
      .flatMap((index) => [
        `- ${expectedLines[index] ?? '<missing>'}`,
        `+ ${actualLines[index] ?? '<missing>'}`,
      ])
      .join('\n') + '\n'
  );
}

export function featureError(error, seen = new Set()) {
  if (!(error instanceof Error)) return { message: String(error) };
  if (seen.has(error)) return { name: error.name, message: '[circular error reference]' };
  seen.add(error);
  return {
    name: error.name,
    message: error.message,
    stack: error.stack,
    ...(error.cause === undefined ? {} : { cause: featureError(error.cause, seen) }),
    ...(error instanceof AggregateError
      ? { errors: error.errors.map((cause) => featureError(cause, seen)) }
      : {}),
  };
}

export function incompleteFeatureGolden(observedRuns, recovery, error) {
  return [
    'Playwright packed-consumer setup and retention',
    'INCOMPLETE: feature acceptance failed; remaining claims are unverified',
    ...observedRuns.map(
      (run) => `${run.mode}: exit=${run.exitCode ?? 'not-observed'} validation=${run.status}`,
    ),
    `owned sandboxes recovered without Docker resources: ${recovery?.recoveries.length ?? 'not-verified'}`,
    `failure: ${error?.message || String(error)}`,
    '',
  ].join('\n');
}

/** Persist comparisons before asserting the outcome, including incomplete runs. */
export async function writeFeatureComparison(resultsRoot, expected, actual) {
  await writeFile(join(resultsRoot, 'acceptance.expected.txt'), expected);
  await writeFile(join(resultsRoot, 'acceptance.actual.txt'), actual);
  const difference = goldenDifference(actual, expected);
  await writeFile(join(resultsRoot, 'golden-diff.txt'), difference);
  return difference;
}
