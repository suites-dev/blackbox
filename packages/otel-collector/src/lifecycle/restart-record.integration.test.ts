import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';

import { readCollectorSession, startCollector } from '../index.js';
import { lifecyclePath } from '../storage/paths.js';
import { collectorControlToken, collectorToken } from '../test-fixtures/collector.js';
import type { CollectorHandle, StartCollectorInput } from '../model/types.js';

function input(storageDirectory: string): StartCollectorInput {
  return {
    kind: 'start-collector',
    storageDirectory,
    sessionId: 'session-interrupted',
    executionId: 'execution-interrupted',
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
      maxRetainedFragments: 32,
      shutdownTimeoutMs: 75,
    },
  };
}

it('records an active prior run as interrupted when the same identity restarts', async () => {
  const root = await mkdtemp(join(tmpdir(), 'blackbox-collector-restart-'));
  const collectorInput = input(root);
  const handles: CollectorHandle[] = [];
  try {
    const first = await startCollector(collectorInput);
    handles.push(first);
    await first.close();
    const prior = await readCollectorSession(collectorInput);
    if (prior.kind !== 'collector-session-found') {
      throw new Error('Expected retained lifecycle.');
    }
    const runs = prior.lifecycle.runs.map((run, index) =>
      index === prior.lifecycle.runs.length - 1
        ? { ...run, receiver: 'ready' as const, shutdown: 'not-started' as const, stoppedAt: null }
        : run,
    );
    await writeFile(
      lifecyclePath(collectorInput),
      `${JSON.stringify({ ...prior.lifecycle, runs })}\n`,
      'utf8',
    );
    const second = await startCollector(collectorInput);
    handles.push(second);
    await second.close();
    expect(await readCollectorSession(collectorInput)).toMatchObject({
      kind: 'collector-session-found',
      lifecycle: {
        runs: [{ receiver: 'interrupted', shutdown: 'interrupted' }, { receiver: 'stopped' }],
      },
    });
  } finally {
    await Promise.all(handles.map(async (handle) => await handle.close()));
    await rm(root, { recursive: true, force: true });
  }
});
