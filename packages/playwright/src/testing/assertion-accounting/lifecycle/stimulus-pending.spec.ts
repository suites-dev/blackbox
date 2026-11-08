import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { rm } from 'node:fs/promises';
import { startCollector } from '@suites/blackbox-otel-collector';
import { sandboxTelemetryStorageDirectory } from '@suites/blackbox-sandbox';
import { createBlackboxTest } from '../../../fixtures.js';
import { createAttemptEffects } from '../../../effects/attempt-effects.js';
import { project } from '../../../envelope/capture/capture.fixture.js';
import { deferred, record } from '../evidence.fixture.js';

const test = createBlackboxTest({
  async start(input) {
    const executionId = randomUUID();
    const storageDirectory = sandboxTelemetryStorageDirectory({ recordDirectory: input.artifactDirectory, sandboxId: executionId });
    const collector = await startCollector({ kind: 'start-collector', sessionId: 'synthetic', executionId, storageDirectory,
      endpoint: { kind: 'http', host: '127.0.0.1', port: 0, tracesPath: '/v1/traces', activationPath: '/v1/activation', readinessPath: '/ready', readPath: '/status' },
      authorization: { kind: 'split-bearer-tokens', ingestToken: 'fixture-ingest', controlToken: 'fixture-control' },
      limits: { maxRequestBytes: 65536, maxRetainedBytes: 262144, maxRetainedFragments: 32, shutdownTimeoutMs: 1000 } });
    return {
      sandbox: {
        sandboxId: executionId, executionId, catalogEntry: { id: 'system', kind: 'system' },
        projectName: executionId, artifactDirectory: input.artifactDirectory,
        entrypoint: { url: 'http://127.0.0.1:1', host: '127.0.0.1', port: 1, protocol: 'http' },
        containers: new Map(),
      },
      telemetry: {
        sessionId: 'synthetic', executionId,
        inspect: () => Promise.resolve({ kind: 'available' as const, endpoints: {
          baseUrl: collector.endpoint.baseUrl, tracesUrl: collector.endpoint.tracesUrl,
          activationUrl: collector.endpoint.activationUrl, readUrl: collector.endpoint.readUrl } }),
        read: () => Promise.reject(new Error('not used')),
        readTrace: () => Promise.reject(new Error('not used')),
      },
      effects: createAttemptEffects({ sessionId: 'synthetic', executionId, storageDirectory }).effects,
      stop: async () => {
        const closed = await collector.close();
        if (closed.kind !== 'collector-stopped') { throw new Error('Pending lifecycle collector cleanup failed'); }
        record('pending-lifecycle-cleanup', 'completed');
      },
    };
  },
});
let root = '';
test.beforeAll(async ({ browserName }, info) => { void browserName; root = await project(); info.config.metadata.blackboxConfigFile = join(root, 'blackbox.config.yaml'); });
test.afterAll(async () => { await rm(root, { recursive: true, force: true }); });
test.use({ blackbox: { system: { kind: 'system', id: 'system' }, finalSnapshot: false } });

test('pending public stimulus action fails teardown', async ({ stimulus }) => {
  const entered = deferred<undefined>();
  void stimulus('When action never settles', async () => {
    entered.resolve(undefined);
    await new Promise<never>(() => undefined);
  });
  await entered.promise;
  record('pending-lifecycle-body', { phase: 'action', calls: 1 });
});

test('pending public precondition fails teardown without action', async ({ stimulus }) => {
  const entered = deferred<undefined>();
  let calls = 0;
  void stimulus('When precondition never settles', () => { calls++; }, {
    precondition: { name: 'Given unfinished checking', check: async () => {
      entered.resolve(undefined);
      await new Promise<never>(() => undefined);
    } },
  });
  await entered.promise;
  record('pending-lifecycle-body', { phase: 'precondition', calls });
});

test('pending public verification fails teardown', async ({ stimulus }) => {
  const entered = deferred<undefined>();
  let calls = 0;
  const outcome = await stimulus('When action completes', () => { calls++; });
  void outcome.verify('Then verification never settles', async () => {
    entered.resolve(undefined);
    await new Promise<never>(() => undefined);
  });
  await entered.promise;
  record('pending-lifecycle-body', { phase: 'claim', calls });
});
