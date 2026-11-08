import { createServer, type Server } from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { rm } from 'node:fs/promises';
import { startCollector, type CollectorHandle } from '@suites/blackbox-otel-collector';
import { sandboxTelemetryStorageDirectory } from '@suites/blackbox-sandbox';
import { createBlackboxTest } from '../../../fixtures.js';
import { createAttemptEffects } from '../../../effects/attempt-effects.js';
import { operationSpan } from '../../../effects/testing/collector.fixture.js';
import { project } from '../../../envelope/capture/capture.fixture.js';
import type { BlackboxAttemptInput } from '../../../runtime/acquisition.js';
import { record } from '../evidence.fixture.js';

interface ReceivedRequest { readonly traceId: string; readonly spanId: string; readonly route: string }
interface Fixture {
  readonly url: string;
  readonly requests: readonly ReceivedRequest[];
  exported(): number;
  exportRequest(index: number): Promise<void>;
}
const fixtures = new Map<string, Fixture>();
const ingestToken = 'lazy-fixture-ingest';

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve(); });
  });
  const address = server.address();
  if (address === null || typeof address === 'string') { throw new Error('Missing owned listener'); }
  return `http://127.0.0.1:${address.port}`;
}
function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => { if (error) { reject(error); } else { resolve(); } });
  });
}
async function exportRequest(collector: CollectorHandle, request: ReceivedRequest): Promise<void> {
  const span = operationSpan({ ...request, attributes: { 'http.request.method': 'POST', 'http.route': request.route } });
  const response = await fetch(collector.endpoint.tracesUrl, {
    method: 'POST', headers: { authorization: `Bearer ${ingestToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ resourceSpans: [{ scopeSpans: [{ spans: [span] }] }] }),
  });
  const body = await response.text();
  if (!response.ok) { throw new Error(`Owned collector rejected export: ${response.status} ${body}`); }
}
async function start(input: BlackboxAttemptInput) {
  const executionId = randomUUID();
  const storageDirectory = sandboxTelemetryStorageDirectory({ recordDirectory: input.artifactDirectory, sandboxId: executionId });
  const collector = await startCollector({ kind: 'start-collector', sessionId: 'lazy-fixture', executionId, storageDirectory,
    endpoint: { kind: 'http', host: '127.0.0.1', port: 0, tracesPath: '/v1/traces', activationPath: '/v1/activation', readinessPath: '/ready', readPath: '/status' },
    authorization: { kind: 'split-bearer-tokens', ingestToken, controlToken: 'lazy-fixture-control' },
    limits: { maxRequestBytes: 65536, maxRetainedBytes: 262144, maxRetainedFragments: 32, shutdownTimeoutMs: 1000 } });
  const requests: ReceivedRequest[] = [];
  const server = createServer((incoming, response) => {
    const traceparent = incoming.headers.traceparent;
    if (incoming.method !== 'POST' || typeof traceparent !== 'string' || !/^00-[a-f0-9]{32}-[a-f0-9]{16}-[a-f0-9]{2}$/u.test(traceparent)) {
      response.writeHead(400).end(); return;
    }
    requests.push({ traceId: traceparent.split('-')[1], spanId: randomBytes(8).toString('hex'), route: incoming.url ?? '/' });
    // Response completion deliberately precedes every collector export.
    const body = JSON.stringify({ accepted: requests.length });
    response.writeHead(201, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) }).end(body);
  });
  let url: string;
  try { url = await listen(server); }
  catch (error) { await collector.close(); throw error; }
  let exported = 0;
  fixtures.set(executionId, { url, requests, exported: () => exported, async exportRequest(index) {
    const request = requests.at(index);
    if (request === undefined) { throw new Error('No received request at the requested export slot'); }
    await exportRequest(collector, request); exported++;
  } });
  return {
    sandbox: {
      sandboxId: executionId, executionId, catalogEntry: { id: 'system', kind: 'system' as const },
      projectName: executionId, artifactDirectory: input.artifactDirectory,
      entrypoint: { url, host: '127.0.0.1', port: Number(new URL(url).port), protocol: 'http' as const }, containers: new Map(),
    },
    telemetry: {
      sessionId: 'lazy-fixture', executionId,
      inspect: () => Promise.resolve({ kind: 'available' as const, endpoints: {
        baseUrl: collector.endpoint.baseUrl, tracesUrl: collector.endpoint.tracesUrl,
        activationUrl: collector.endpoint.activationUrl, readUrl: collector.endpoint.readUrl } }),
      read: () => Promise.reject(new Error('not used')), readTrace: () => Promise.reject(new Error('not used')),
    },
    effects: createAttemptEffects({ sessionId: 'lazy-fixture', executionId, storageDirectory }).effects,
    async stop() {
      const results = await Promise.allSettled([closeServer(server), collector.close()]);
      const closed = results[1];
      fixtures.delete(executionId);
      record('lazy-cleanup', { executionId, serverListening: server.listening,
        collector: closed.status === 'fulfilled' ? closed.value.kind : 'collector-close-failed', requests: requests.length, exported });
      const failures = results.flatMap((result) => result.status === 'rejected' ? [result.reason as unknown] : []);
      if (failures.length > 0) { throw new AggregateError(failures, 'Owned fixture cleanup failed'); }
      if (closed.status === 'fulfilled' && closed.value.kind !== 'collector-stopped') { throw new Error('Owned collector cleanup failed'); }
    },
  };
}
export const test = createBlackboxTest({ start });
export function fixtureFor(executionId: string): Fixture {
  const fixture = fixtures.get(executionId);
  if (fixture === undefined) { throw new Error('No owned lazy fixture for this attempt'); }
  return fixture;
}
export function useProject(): void {
  let root: string;
  test.beforeAll(async ({ browserName }, info) => {
    void browserName;
    root = await project(); info.config.metadata.blackboxConfigFile = join(root, 'blackbox.config.yaml');
  });
  test.afterAll(async () => { await rm(root, { recursive: true, force: true }); });
  test.use({ blackbox: { system: { kind: 'system', id: 'system' }, finalSnapshot: false, retainAttempts: true } });
}
