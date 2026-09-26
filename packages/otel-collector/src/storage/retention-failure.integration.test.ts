import { rename, rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import {
  readCollectorSession,
  readCollectorTrace,
  readCollectorTraces,
  startCollector,
} from '../index.js';
import { fragmentDirectory, lifecyclePath } from './paths.js';
import { postJson, traceA, traceRequest, withCollector } from '../test-fixtures/collector.js';

it('reports corruption when a previously acknowledged fragment disappears', async () => {
  await withCollector(async ({ input, collector }) => {
    expect((await postJson(collector, traceRequest())).status).toBe(200);
    await collector.close();
    await rm(join(fragmentDirectory(input), '000000000001.json'));
    expect(await readCollectorSession(input)).toMatchObject({ kind: 'collector-session-corrupt' });
    expect(await readCollectorTrace({ ...input, traceId: traceA })).toMatchObject({
      kind: 'collector-trace-corrupt',
    });
    expect(await readCollectorTraces(input)).toMatchObject({ kind: 'collector-traces-corrupt' });
  });
});

it('does not acknowledge successful capture when lifecycle persistence fails after fragment storage', async () => {
  await withCollector(async ({ input, collector }) => {
    const lifecycle = lifecyclePath(input);
    await rename(lifecycle, `${lifecycle}.retained`);
    await mkdir(lifecycle);
    const response = await postJson(collector, traceRequest());
    expect(response.status).toBe(500);
    expect(collector.status()).toMatchObject({
      receiver: 'failed',
      failure: { message: expect.any(String) },
    });
    expect((await collector.close()).kind).toBe('collector-stop-failed');
  });
});

it('releases its storage lease after binding fails on another collector port', async () => {
  await withCollector(async ({ input, collector }) => {
    const alternate = {
      ...input,
      executionId: 'second-execution',
      endpoint: { ...input.endpoint, port: collector.endpoint.port },
    };
    await expect(startCollector(alternate)).rejects.toMatchObject({ code: 'EADDRINUSE' });
    const retry = await startCollector({
      ...alternate,
      endpoint: { ...alternate.endpoint, port: 0 },
    });
    try {
      expect(retry.status().receiver).toBe('ready');
      expect(retry.endpoint.port).not.toBe(collector.endpoint.port);
    } finally {
      await retry.close();
    }
  });
});
