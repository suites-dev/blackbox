import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';

import { readCollectorSession, startCollector } from '../index.js';
import {
  collectorControlToken,
  collectorToken,
  postJson,
  traceRequest,
} from '../test-fixtures/collector.js';
import type { CollectorHandle, StartCollectorInput } from '../model/types.js';

function input(storageDirectory: string): StartCollectorInput {
  return {
    kind: 'start-collector',
    storageDirectory,
    sessionId: 'retention-session',
    executionId: 'retention-execution',
    endpoint: {
      kind: 'http',
      host: '127.0.0.1',
      port: 0,
      tracesPath: '/v1/traces',
      activationPath: '/v1/activation',
      readinessPath: '/ready',
      readPath: '/status',
    },
    authorization: {
      kind: 'split-bearer-tokens',
      ingestToken: collectorToken,
      controlToken: collectorControlToken,
    },
    limits: {
      maxRequestBytes: 4096,
      maxRetainedBytes: 65_536,
      maxRetainedFragments: 1,
      shutdownTimeoutMs: 100,
    },
  };
}

it('fails closed before cumulative retention can exceed its fragment bound', async () => {
  const root = await mkdtemp(join(tmpdir(), 'blackbox-retention-limit-'));
  const collectorInput = input(root);
  const handles: CollectorHandle[] = [];
  try {
    const first = await startCollector(collectorInput);
    handles.push(first);
    expect((await postJson(first, traceRequest())).status).toBe(200);
    await first.close();

    const second = await startCollector(collectorInput);
    handles.push(second);
    const rejected = await postJson(second, traceRequest());
    expect(rejected.status).toBe(507);
    expect(second.status()).toMatchObject({
      receiver: 'failed',
      failure: { name: 'CollectorRetentionLimitError' },
    });
    const retained = await readCollectorSession(collectorInput);
    expect(retained).toMatchObject({
      kind: 'collector-session-found',
      fragments: [{ sequence: 1 }],
    });
  } finally {
    await Promise.all(handles.map(async (handle) => await handle.close()));
    await rm(root, { recursive: true, force: true });
  }
});
