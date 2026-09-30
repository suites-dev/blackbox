import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const script = resolve(dirname(fileURLToPath(import.meta.url)), 'capsule-telemetry-proof.mjs');
const activityTrace = '11111111111111111111111111111111';
const downstreamTrace = '22222222222222222222222222222222';
const activityId = 'activity-1';

function attribute(key, value) {
  return { key, value: { stringValue: value } };
}

function span(input) {
  return {
    traceId: input.traceId,
    spanId: input.spanId,
    parentSpanId: input.parentSpanId,
    name: input.name,
    attributes: input.attributes,
  };
}

function traceDocument(traceId, resources) {
  return {
    kind: 'collector-trace-found',
    traceId,
    fragments: [{ request: { resourceSpans: resources } }],
  };
}

function resource(service, retained) {
  return {
    resource: { attributes: [attribute('service.name', service)] },
    scopeSpans: [{ scope: { name: `test/${service}` }, spans: retained }],
  };
}

function root() {
  return span({
    traceId: activityTrace,
    spanId: 'aaaaaaaaaaaaaaaa',
    parentSpanId: '',
    name: 'capsule activity',
    attributes: [attribute('blackbox.activity.id', activityId)],
  });
}

function httpTraceDocument({ complete }) {
  const downstream = complete
    ? ['fraud-check', 'order-service', 'payment-mock'].map((service, index) =>
        resource(service, [
          span({
            traceId: activityTrace,
            spanId: `${String(index + 3).repeat(16)}`,
            parentSpanId: 'bbbbbbbbbbbbbbbb',
            name: 'POST',
            attributes: [],
          }),
        ]),
      )
    : [];
  return traceDocument(activityTrace, [
    resource('blackbox-capsule', [root()]),
    resource('public-api', [
      span({
        traceId: activityTrace,
        spanId: 'bbbbbbbbbbbbbbbb',
        parentSpanId: 'aaaaaaaaaaaaaaaa',
        name: 'POST',
        attributes: [attribute('http.target', '/subscriptions')],
      }),
    ]),
    ...downstream,
  ]);
}

async function write(path, value) {
  await writeFile(path, JSON.stringify(value));
}

void test('proves propagated and session-only OTLP relationships by exact trace identity', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'blackbox-telemetry-proof-'));
  try {
    const execution = join(directory, 'execution.json');
    const activity = join(directory, 'activity.json');
    const httpTrace = join(directory, 'http-trace.json');
    const session = join(directory, 'session.json');
    const traces = join(directory, 'traces');
    await mkdir(traces);
    await write(execution, { kind: 'capsule-exec-completed', activityId });
    await write(activity, {
      kind: 'collector-activity-found',
      activityId,
      traceIds: [activityTrace],
      fragments: traceDocument(activityTrace, [resource('blackbox-capsule', [root()])]).fragments,
    });
    await write(httpTrace, httpTraceDocument({ complete: true }));
    const http = await execute(process.execPath, [script, 'http', execution, activity, httpTrace]);
    assert.equal(JSON.parse(http.stdout).kind, 'propagated-http-telemetry-proof');

    const proofId = 'shared-state-proof-1';
    const proofPath = `/fixture/shared-state-proof/${proofId}`;
    const downstream = traceDocument(downstreamTrace, [
      ...['redis-proof-consumer', 'public-api'].map((service, index) =>
        resource(service, [
          span({
            traceId: downstreamTrace,
            spanId: `${String(index + 7).repeat(16)}`,
            parentSpanId: '',
            name: 'POST',
            attributes: [attribute('url.path', proofPath)],
          }),
        ]),
      ),
    ]);
    await write(session, {
      kind: 'collector-session-found',
      traceIds: [activityTrace, downstreamTrace],
    });
    await write(join(traces, `${activityTrace}.json`), await readJson(httpTrace));
    await write(join(traces, `${downstreamTrace}.json`), downstream);
    const shared = await execute(process.execPath, [
      script,
      'shared-state',
      execution,
      activity,
      session,
      traces,
      proofId,
    ]);
    assert.deepEqual(JSON.parse(shared.stdout), {
      kind: 'shared-state-session-observation-proof',
      stimulusActivityId: activityId,
      stimulusTraceId: activityTrace,
      downstreamTraceId: downstreamTrace,
      downstreamPath: proofPath,
      association: { kind: 'session-only' },
      services: ['public-api', 'redis-proof-consumer'],
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

void test('polls the public exact-trace command until the semantic HTTP proof is complete', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'blackbox-telemetry-poll-'));
  try {
    const execution = join(directory, 'execution.json');
    const activity = join(directory, 'activity.json');
    const partial = join(directory, 'partial.json');
    const complete = join(directory, 'complete.json');
    const retained = join(directory, 'retained-trace.json');
    const diagnostics = join(directory, 'last-incomplete.txt');
    const counter = join(directory, 'counter.txt');
    const fakeCli = join(directory, 'blackbox.mjs');
    await write(execution, { kind: 'capsule-exec-completed', activityId });
    await write(activity, {
      kind: 'collector-activity-found',
      activityId,
      traceIds: [activityTrace],
      fragments: traceDocument(activityTrace, [resource('blackbox-capsule', [root()])]).fragments,
    });
    await write(partial, httpTraceDocument({ complete: false }));
    await write(complete, httpTraceDocument({ complete: true }));
    await writeFile(
      fakeCli,
      `#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
const counter = ${JSON.stringify(counter)};
const attempt = existsSync(counter) ? Number(readFileSync(counter, 'utf8')) + 1 : 1;
writeFileSync(counter, String(attempt));
process.stdout.write(readFileSync(attempt === 1 ? ${JSON.stringify(partial)} : ${JSON.stringify(complete)}, 'utf8'));
`,
    );
    await chmod(fakeCli, 0o755);
    const result = await execute(process.execPath, [
      script,
      'http-until',
      fakeCli,
      'session-1',
      activityTrace,
      execution,
      activity,
      retained,
      diagnostics,
    ]);
    assert.equal(await readFile(counter, 'utf8'), '2');
    assert.deepEqual(await readJson(retained), httpTraceDocument({ complete: true }));
    assert.match(await readFile(diagnostics, 'utf8'), /instrumented service fraud-check/u);
    assert.equal(JSON.parse(result.stdout).kind, 'propagated-http-telemetry-proof');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}
