import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { readCollectorLifecycle, readCollectorSession, startCollector } from '../index.js';
import { fragmentDirectory, lifecyclePath } from '../storage/paths.js';
import {
  collectorControlToken,
  collectorToken,
  postJson,
  traceRequest,
} from '../test-fixtures/collector.js';
import type { CollectorHandle, StartCollectorInput } from '../model/types.js';

function collectorInput(storageDirectory: string, identity: string): StartCollectorInput {
  return {
    kind: 'start-collector',
    storageDirectory,
    sessionId: `session-${identity}`,
    executionId: `execution-${identity}`,
    endpoint: {
      kind: 'http',
      host: '127.0.0.1',
      port: 0,
      tracesPath: '/v1/traces',
      activationPath: '/v1/activation',
      readinessPath: '/ready',
      readPath: '/v1/collector',
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

async function temporaryRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'blackbox-collector-lifecycle-'));
}

async function trackedStart(
  input: StartCollectorInput,
  handles: CollectorHandle[],
): Promise<CollectorHandle> {
  const collector = await startCollector(input);
  handles.push(collector);
  return collector;
}

async function cleanup(input: {
  readonly root: string;
  readonly handles: CollectorHandle[];
}): Promise<void> {
  await Promise.all(input.handles.map((handle) => handle.close()));
  await rm(input.root, { recursive: true, force: true });
}

it('reads the lifecycle counters alone, without reading any retained fragment', async () => {
  const root = await temporaryRoot();
  const input = collectorInput(root, 'lifecycle-only');
  const handles: CollectorHandle[] = [];
  try {
    expect(await readCollectorLifecycle(input)).toMatchObject({
      kind: 'collector-lifecycle-missing',
      message: expect.stringMatching(/exact identity/u),
    });
    const collector = await trackedStart(input, handles);
    await postJson(collector, traceRequest());
    await collector.close();
    const found = await readCollectorLifecycle(input);
    expect(found).toMatchObject({
      kind: 'collector-lifecycle-found',
      lifecycle: { telemetry: { status: 'received', acceptedSpans: 2 } },
    });
    // A corrupt fragment breaks every fragment read, but not the lifecycle read.
    await writeFile(join(fragmentDirectory(input), '000000000001.json'), '{}\n', 'utf8');
    expect((await readCollectorSession(input)).kind).toBe('collector-session-corrupt');
    expect(await readCollectorLifecycle(input)).toEqual(found);
    // The record itself is still validated.
    await writeFile(lifecyclePath(input), '{}\n', 'utf8');
    expect((await readCollectorLifecycle(input)).kind).toBe('collector-lifecycle-corrupt');
  } finally {
    await cleanup({ root, handles });
  }
});
