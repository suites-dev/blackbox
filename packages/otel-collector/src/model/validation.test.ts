import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { startCollector } from '../index.js';
import type { StartCollectorInput } from './types.js';

function validInput(storageDirectory: string): StartCollectorInput {
  return {
    kind: 'start-collector',
    storageDirectory,
    sessionId: 'validation-session',
    executionId: 'validation-execution',
    endpoint: {
      kind: 'http',
      host: '127.0.0.1',
      port: 0,
      tracesPath: '/v1/traces',
      readPath: '/v1/collector',
    },
    limits: { maxRequestBytes: 4096, shutdownTimeoutMs: 75 },
  };
}

it('validates explicit identity, storage, paths, ports, and limits before binding', async () => {
  const root = await mkdtemp(join(tmpdir(), 'blackbox-collector-validation-'));
  const input = validInput(root);
  try {
    await expect(startCollector({ ...input, sessionId: '../escape' })).rejects.toThrow('sessionId');
    await expect(startCollector({ ...input, storageDirectory: 'relative' })).rejects.toThrow(
      'absolute',
    );
    await expect(
      startCollector({ ...input, endpoint: { ...input.endpoint, port: 70_000 } }),
    ).rejects.toThrow('port');
    await expect(
      startCollector({ ...input, endpoint: { ...input.endpoint, tracesPath: 'relative' } }),
    ).rejects.toThrow('path');
    await expect(
      startCollector({ ...input, limits: { ...input.limits, maxRequestBytes: 0 } }),
    ).rejects.toThrow('positive');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
