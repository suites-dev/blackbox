import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';
import { lstat, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { expect as nativeExpect } from '@playwright/test';
import { startCollector, type CollectorHandle } from '@suites/blackbox-otel-collector';
import { sandboxTelemetryStorageDirectory } from '@suites/blackbox-sandbox';
import { expect } from '../../../index.js';
import type { ExecutionResult } from '../../../stimulus/lifecycle/types.js';
import { createBlackboxTest } from '../../../fixtures.js';
import { createAttemptEffects } from '../../../effects/attempt-effects.js';
import { project } from '../../../envelope/capture/capture.fixture.js';
import { operationSpan } from '../../../effects/testing/collector.fixture.js';
import { record } from '../evidence.fixture.js';

let fixtureCollector: CollectorHandle | null = null;
let fixtureCorruptFinalization = false;
const fixtureTest = createBlackboxTest({
  async start(input) {
    const executionId = randomUUID();
    fixtureCorruptFinalization = false;
    const storageDirectory = sandboxTelemetryStorageDirectory({ recordDirectory: input.artifactDirectory, sandboxId: executionId });
    const collector = await startCollector({ kind: 'start-collector', sessionId: 'fixture-session', executionId,
      storageDirectory,
      endpoint: { kind: 'http', host: '127.0.0.1', port: 0, tracesPath: '/v1/traces', activationPath: '/v1/activation', readinessPath: '/ready', readPath: '/status' },
      authorization: { kind: 'split-bearer-tokens', ingestToken: 'fixture-ingest', controlToken: 'fixture-control' },
      redaction: { kind: 'credentials-v1', secrets: ['synthetic-password'] },
      limits: { maxRequestBytes: 65536, maxRetainedBytes: 262144, maxRetainedFragments: 32, shutdownTimeoutMs: 1000 } });
    fixtureCollector = collector;
    return {
      sandbox: {
        sandboxId: executionId, executionId, catalogEntry: { id: 'system', kind: 'system' },
        projectName: executionId, artifactDirectory: input.artifactDirectory,
        entrypoint: { url: 'http://127.0.0.1:1', host: '127.0.0.1', port: 1, protocol: 'http' },
        containers: new Map(),
      },
      telemetry: {
        sessionId: 'fixture-session', executionId,
        inspect: () => Promise.resolve({ kind: 'available' as const, endpoints: {
          baseUrl: collector.endpoint.baseUrl, tracesUrl: collector.endpoint.tracesUrl,
          activationUrl: collector.endpoint.activationUrl, readUrl: collector.endpoint.readUrl } }),
        read: () => Promise.reject(new Error('not used')),
        readTrace: () => Promise.reject(new Error('not used')),
      },
      effects: createAttemptEffects({ sessionId: 'fixture-session', executionId, storageDirectory }).effects,
      stop: async () => { const result = await collector.close(); if (result.kind !== 'collector-stopped') { throw new Error('collector cleanup failed'); }
        record('fixture-collector-closed', true);
        if (fixtureCorruptFinalization) { await rm(storageDirectory, { recursive: true, force: true }); } },
    };
  },
});
async function inspectRetained(root: string): Promise<void> {
    try {
      const experiments = join(root, '.blackbox', 'experiments');
      const attempts = await readdir(experiments);
      const files: string[] = [];
      let blocked = 0;
      for (const attempt of attempts) {
        const evidence = join(experiments, attempt, 'sandbox', 'execution-evidence');
        if (!(await lstat(evidence)).isDirectory()) { blocked++; continue; }
        for (const sequence of await readdir(evidence)) {
          for (const name of await readdir(join(evidence, sequence))) {
            files.push(await readFile(join(evidence, sequence, name), 'utf8'));
          }
        }
      }
      record('retained-executions', { attempts: attempts.length, files: files.length, blocked,
        leaked: files.some((file) => file.includes('synthetic-password')) });
    } finally { await rm(root, { recursive: true, force: true }); }
}
function registerResponseCaptureTest(): void {
  fixtureTest('captures ordinary responses and rejects oversized output', async ({ stimulus }, info) => {
    info.fail();
    const server = createServer((request, response) => {
      if (request.url === '/gzip') {
        const body = gzipSync(JSON.stringify({ value: 'compressed', password: 'synthetic-password' }));
        response.writeHead(200, { 'content-encoding': 'gzip', 'content-length': body.length }).end(body);
      } else if (request.url === '/oversized') {
        response.writeHead(200).end(JSON.stringify(Array.from({ length: 3_000 }, () => 'x'.repeat(90))));
      } else if (request.url === '/no-length') {
        response.useChunkedEncodingByDefault = false;
        response.writeHead(200, { connection: 'close' });
        response.write('no-length'); response.end();
      } else {
        response.writeHead(200); response.write('chunked'); response.end();
      }
    });
    await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve); });
    try {
      const address = server.address();
      if (address === null || typeof address === 'string') { throw new Error('missing listener'); }
      for (const path of ['/chunked', '/gzip', '/no-length']) {
        const { result } = await stimulus(`When ${path} is returned`, ({ request }) => request.get(`http://127.0.0.1:${address.port}${path}`));
        nativeExpect(result.status()).toBe(200);
      }
      record('ordinary-responses-captured', true);
      let caught = false;
      try { await stimulus('When oversized output is returned', ({ request }) => request.get(`http://127.0.0.1:${address.port}/oversized`)); }
      catch { caught = true; }
      record('oversized-response-caught', caught);
      nativeExpect(caught).toBe(true);
    } finally { await new Promise<void>((resolve, reject) => { server.close((error) => { if (error) { reject(error); } else { resolve(); } }); }); }
  });
}
function registerOversizedFinalSelectionTest(): void {
  fixtureTest('bounds the supplemental capture while retaining nine stimuli', async ({ stimulus }) => {
    for (let index = 0; index < 9; index++) {
      await stimulus(`When activity ${String(index)} completes`, () => undefined);
    }
    record('completed-nine-stimuli', true);
  });
}
async function concurrentClaims(verify: ExecutionResult<unknown>['verify'], check: () => void, emission: () => Promise<void>): Promise<void> {
  let release: (() => void) | undefined;
  let entered: (() => void) | undefined;
  const ready = new Promise<void>((resolve) => { entered = resolve; });
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const first = verify('And the delayed claim passes', async () => { if (entered !== undefined) { entered(); } await gate; check(); });
  await ready;
  await verify('And the concurrent emission is observed', emission);
  if (release !== undefined) { release(); }
  await first;
}
fixtureTest.describe('actual lifecycle fixture', () => {
  let root = '';
  fixtureTest.beforeAll(async ({ browserName }, info) => { void browserName; root = await project(); info.config.metadata.blackboxConfigFile = join(root, 'blackbox.config.yaml'); });
  fixtureTest.afterAll(async () => { await inspectRetained(root); });
  fixtureTest.use({ blackbox: { system: { kind: 'system', id: 'system' }, finalSnapshot: false, retainAttempts: true } });
  fixtureTest('injects the native stimulus fixture and verifies its captured state', async ({ stimulus, state, request }) => {
    let value = 0;
    let traceparent: string | string[] | undefined;
    const server = createServer((incoming, response) => { void (async () => {
      traceparent = incoming.headers.traceparent;
      if (typeof traceparent !== 'string' || fixtureCollector === null) { throw new Error('missing trace or collector'); }
      const span = operationSpan({ traceId: traceparent.split('-')[1], spanId: '1234567890abcdef',
        attributes: { 'http.request.method': 'POST', 'http.route': '/payments' } });
      const exported = await fetch(fixtureCollector.endpoint.tracesUrl, { method: 'POST',
        headers: { authorization: 'Bearer fixture-ingest', 'content-type': 'application/json' },
        body: JSON.stringify({ resourceSpans: [{ scopeSpans: [{ spans: [span] }] }] }) });
      if (!exported.ok) { throw new Error('fixture telemetry export failed'); }
      const body = JSON.stringify({ id: 'pi_created', password: 'synthetic-password' });
      response.writeHead(201, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) }).end(body);
    })().catch(() => { response.writeHead(500).end(); }); });
    await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve); });
    try {
      const address = server.address();
      if (address === null || typeof address === 'string') { throw new Error('missing owned listener'); }
      const counter = state.observe('counter', { value: () => value });
      const { result, evidence, verify } = await stimulus('When incrementing', async (scope) => {
        nativeExpect(scope.request).toBe(request);
        value++;
        return scope.request.post(`http://127.0.0.1:${address.port}/payments`, { headers: scope.headers });
      }, { precondition: { name: 'Given zero', check: ({ initial }) => { expect(initial(counter).value).toBe(0); } } });
      await verify('Then the state changed', () => {
        expect(result.status()).toBe(201);
        expect(evidence.state(counter).diff.value).toEqual({ before: 0, after: 1, changed: true });
      });
      if (evidence.effects === undefined) { throw new Error('missing stimulus effect capture'); }
      const recorder = evidence.effects.http({ method: 'POST', route: '/payments' });
      await verify('And the request was observed', async () => { await expect(recorder).toHaveEmitted(); });
      await verify('And the state matches the reviewed baseline', () => { expect(`${String(evidence.state(counter).final.value)}\n`).toMatchSnapshot('counter.txt'); });
      await concurrentClaims(verify, () => { expect(result.status()).toBe(201); }, async () => { await expect(recorder).toHaveEmitted(); });
      await nativeExpect(expect.configure({ timeout: 100 })(evidence.effects.http({ method: 'GET' })).not.toHaveEmitted()).rejects.toThrow(/inconclusive/);
      nativeExpect(traceparent).toMatch(/^00-/);
    } finally { await new Promise<void>((resolve, reject) => { server.close((error) => { if (error) { reject(error); } else { resolve(); } }); }); }

  });
  fixtureTest('unasserted output capture failure still fails the attempt', async ({ stimulus }, info) => {
    info.fail();
    let caught = false;
    try { await stimulus('When unsupported output is returned', () => Symbol('unsupported')); }
    catch { caught = true; }
    record('unasserted-capture-caught', caught);
    nativeExpect(caught).toBe(true);
  });
  fixtureTest('unwritable evidence fails the attempt', async ({ stimulus }, info) => {
    info.fail();
    await writeFile(info.outputPath('blackbox', 'execution-evidence'), 'blocked', { flag: 'wx' });
    let caught = false;
    try { await stimulus('When evidence storage is blocked', () => ({ status: 'ok' })); }
    catch { caught = true; }
    record('persistence-failure-caught', caught);
    nativeExpect(caught).toBe(true);
  });
  fixtureTest('lost final collector state fails even without a final snapshot', async ({ stimulus }, info) => {
    info.fail();
    await stimulus('When final collector state will be lost', () => undefined);
    fixtureCorruptFinalization = true;
    record('final-capture-body-completed', true);
  });
  fixtureTest('receipt attachment failure preserves cleanup and evidence', async ({ stimulus }, info) => {
    info.fail();
    const attach = info.attach.bind(info);
    info.attach = async (name, options) => {
      if (name === 'blackbox-receipt') { record('receipt-attachment-rejected', true); throw new Error('receipt blocked'); }
      await attach(name, options);
    };
    await stimulus('When the receipt will fail', () => ({ status: 'ok' }));
    record('receipt-action-completed', true);
  });
  registerResponseCaptureTest();
  registerOversizedFinalSelectionTest();
});
