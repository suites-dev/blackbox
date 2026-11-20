import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { readdir, rm } from 'node:fs/promises';
import { startCollector } from '@suites/blackbox-otel-collector';
import { sandboxTelemetryStorageDirectory } from '@suites/blackbox-sandbox';
import { createBlackboxTest } from '../../../fixtures.js';
import { createAttemptEffects } from '../../../effects/attempt-effects.js';
import { project } from '../../../envelope/capture/capture.fixture.js';
import { record } from '../evidence.fixture.js';

const test = createBlackboxTest({
  async start(input) {
    const executionId = randomUUID();
    const storageDirectory = sandboxTelemetryStorageDirectory({ recordDirectory: input.artifactDirectory, sandboxId: executionId });
    const collector = await startCollector({ kind: 'start-collector', sessionId: 'fixture-session', executionId, storageDirectory,
      endpoint: { kind: 'http', host: '127.0.0.1', port: 0, tracesPath: '/v1/traces', activationPath: '/v1/activation', readinessPath: '/ready', readPath: '/status' },
      authorization: { kind: 'split-bearer-tokens', ingestToken: 'fixture-ingest', controlToken: 'fixture-control' },
      limits: { maxRequestBytes: 65536, maxRetainedBytes: 262144, maxRetainedFragments: 32, shutdownTimeoutMs: 1000 } });
    return {
      sandbox: { sandboxId: executionId, executionId, catalogEntry: { id: 'system', kind: 'system' }, projectName: executionId,
        artifactDirectory: input.artifactDirectory, entrypoint: { url: 'http://127.0.0.1:1', host: '127.0.0.1', port: 1, protocol: 'http' }, containers: new Map() },
      telemetry: { sessionId: 'fixture-session', executionId,
        inspect: () => Promise.resolve({ kind: 'available' as const, endpoints: { baseUrl: collector.endpoint.baseUrl, tracesUrl: collector.endpoint.tracesUrl, activationUrl: collector.endpoint.activationUrl, readUrl: collector.endpoint.readUrl } }),
        read: () => Promise.reject(new Error('not used')), readTrace: () => Promise.reject(new Error('not used')) },
      effects: createAttemptEffects({ sessionId: 'fixture-session', executionId, storageDirectory }).effects,
      stop: async () => { const result = await collector.close(); record('timeout-collector-closed', result.kind); },
    };
  },
});
let root = '';
test.beforeAll(async ({ browserName }, info) => { void browserName; root = await project(); info.config.metadata.blackboxConfigFile = join(root, 'blackbox.config.yaml'); });
test.afterAll(async () => {
  try { record('timeout-retained-attempts', (await readdir(join(root, '.blackbox', 'experiments'))).length); }
  finally { await rm(root, { recursive: true, force: true }); }
});
test.use({ blackbox: { system: { kind: 'system', id: 'system' }, finalSnapshot: false, retainAttempts: true } });
test('timeout retains interrupted execution', async ({ stimulus }) => {
  test.setTimeout(500);
  await stimulus('When the action is interrupted', async () => {
    record('timeout-action-started', true);
    await new Promise<never>(() => undefined);
  });
});
