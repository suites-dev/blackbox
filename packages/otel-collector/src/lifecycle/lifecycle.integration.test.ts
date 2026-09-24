import { createServer, request as httpRequest, type Server } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { readCollectorSession, readCollectorTrace, startCollector } from '../index.js';
import { fragmentDirectory, lifecyclePath } from '../storage/paths.js';
import { collectorToken, postJson, traceA, traceRequest } from '../test-fixtures/collector.js';
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
    authorization: { kind: 'bearer-token', token: collectorToken },
    limits: { maxRequestBytes: 4096, shutdownTimeoutMs: 75 },
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

async function occupyPort(): Promise<{ readonly server: Server; readonly port: number }> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('Test server did not bind.');
  }
  return { server, port: address.port };
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => {
      if (error === undefined) {
        resolve();
      } else {
        reject(error);
      }
    }),
  );
}

it('retains exact-session and trace reads across stop and restart', async () => {
  const root = await temporaryRoot();
  const input = collectorInput(root, 'restart');
  const handles: CollectorHandle[] = [];
  try {
    const first = await trackedStart(input, handles);
    expect((await postJson(first, traceRequest())).status).toBe(200);
    expect((await first.close()).kind).toBe('collector-stopped');
    expect(await readCollectorTrace({ ...input, traceId: traceA })).toMatchObject({
      kind: 'collector-trace-found',
    });
    const second = await trackedStart(input, handles);
    expect(second.status().telemetry).toMatchObject({ status: 'received', acceptedSpans: 2 });
    expect((await postJson(second, traceRequest())).status).toBe(200);
    await second.close();
    const session = await readCollectorSession(input);
    expect(session).toMatchObject({
      kind: 'collector-session-found',
      fragments: [{ sequence: 1 }, { sequence: 2 }],
      lifecycle: { runs: [{ receiver: 'stopped' }, { receiver: 'stopped' }] },
    });
  } finally {
    await cleanup({ root, handles });
  }
});

it('isolates concurrent collectors and rejects a duplicate exact lifecycle owner', async () => {
  const root = await temporaryRoot();
  const firstInput = collectorInput(root, 'one');
  const secondInput = collectorInput(root, 'two');
  const handles: CollectorHandle[] = [];
  try {
    const [first, second] = await Promise.all([
      trackedStart(firstInput, handles),
      trackedStart(secondInput, handles),
    ]);
    expect(first.endpoint.port).not.toBe(second.endpoint.port);
    await expect(startCollector(firstInput)).rejects.toThrow('already owns');
    expect((await postJson(first, traceRequest())).status).toBe(200);
    expect((await postJson(second, {})).status).toBe(200);
    expect((await readCollectorSession(firstInput)).kind).toBe('collector-session-found');
    expect((await readCollectorSession(secondInput)).kind).toBe('collector-session-found');
  } finally {
    await cleanup({ root, handles });
  }
});

it('reports a startup port conflict and releases the unstarted lifecycle lease', async () => {
  const root = await temporaryRoot();
  const blocker = await occupyPort();
  const base = collectorInput(root, 'port-conflict');
  const input = {
    ...base,
    endpoint: { ...base.endpoint, port: blocker.port },
  } satisfies StartCollectorInput;
  const handles: CollectorHandle[] = [];
  try {
    await expect(startCollector(input)).rejects.toMatchObject({ code: 'EADDRINUSE' });
    await closeServer(blocker.server);
    const collector = await trackedStart(input, handles);
    expect(collector.endpoint.port).toBe(blocker.port);
    await collector.close();
  } finally {
    if (blocker.server.listening) {
      await closeServer(blocker.server);
    }
    await cleanup({ root, handles });
  }
});

it('reports missing and corrupt retained records without treating an error as empty data', async () => {
  const root = await temporaryRoot();
  const input = collectorInput(root, 'corrupt');
  const handles: CollectorHandle[] = [];
  try {
    expect(await readCollectorSession(input)).toMatchObject({
      kind: 'collector-session-missing',
      message: expect.stringMatching(/exact identity/u),
    });
    const collector = await trackedStart(input, handles);
    await postJson(collector, traceRequest());
    await collector.close();
    await writeFile(join(fragmentDirectory(input), '000000000001.json'), '{}\n', 'utf8');
    expect(await readCollectorSession(input)).toMatchObject({
      kind: 'collector-session-corrupt',
      error: { message: expect.stringMatching(/corrupt/u) },
    });
    expect(await readCollectorTrace({ ...input, traceId: traceA })).toMatchObject({
      kind: 'collector-trace-corrupt',
      error: { message: expect.stringMatching(/corrupt/u) },
    });
  } finally {
    await cleanup({ root, handles });
  }
});

it('reports durable write failure and preserves failed lifecycle through close', async () => {
  const root = await temporaryRoot();
  const input = collectorInput(root, 'write-failure');
  const handles: CollectorHandle[] = [];
  const collector = await trackedStart(input, handles);
  try {
    await rm(fragmentDirectory(input), { recursive: true });
    await writeFile(fragmentDirectory(input), 'blocks fragment writes', 'utf8');
    const response = await postJson(collector, traceRequest());
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({
      message: expect.stringMatching(/ENOTDIR|directory/iu),
    });
    expect(collector.status()).toMatchObject({
      receiver: 'failed',
      failure: { message: expect.any(String) },
    });
    expect((await collector.close()).kind).toBe('collector-stop-failed');
    const lifecycle = await readFile(lifecyclePath(input), 'utf8');
    expect(lifecycle).toContain('"receiver": "failed"');
  } finally {
    await cleanup({ root, handles });
  }
});

it('bounds shutdown when a client leaves an OTLP request incomplete', async () => {
  const root = await temporaryRoot();
  const input = collectorInput(root, 'bounded');
  const handles: CollectorHandle[] = [];
  const collector = await trackedStart(input, handles);
  const pending = httpRequest(collector.endpoint.tracesUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'content-length': '1000' },
  });
  pending.on('error', () => undefined);
  pending.write('{');
  await new Promise<void>((resolve) =>
    pending.once('socket', (socket) => socket.once('connect', resolve)),
  );
  const started = Date.now();
  const result = await collector.close();
  try {
    expect(Date.now() - started).toBeLessThan(1000);
    expect(result).toMatchObject({
      kind: 'collector-stop-failed',
      status: { shutdown: 'timed-out' },
      error: { name: 'CollectorShutdownTimeout' },
    });
  } finally {
    pending.destroy();
    await cleanup({ root, handles });
  }
});

it('records an active prior run as interrupted when the same identity restarts', async () => {
  const root = await temporaryRoot();
  const input = collectorInput(root, 'interrupted');
  const handles: CollectorHandle[] = [];
  try {
    const first = await trackedStart(input, handles);
    await first.close();
    const prior = await readCollectorSession(input);
    if (prior.kind !== 'collector-session-found') {
      throw new Error('Expected retained lifecycle.');
    }
    const runs = prior.lifecycle.runs.map((run, index) =>
      index === prior.lifecycle.runs.length - 1
        ? { ...run, receiver: 'ready' as const, shutdown: 'not-started' as const, stoppedAt: null }
        : run,
    );
    await writeFile(
      lifecyclePath(input),
      `${JSON.stringify({ ...prior.lifecycle, runs })}\n`,
      'utf8',
    );
    const second = await trackedStart(input, handles);
    await second.close();
    const restarted = await readCollectorSession(input);
    expect(restarted).toMatchObject({
      kind: 'collector-session-found',
      lifecycle: {
        runs: [{ receiver: 'interrupted', shutdown: 'interrupted' }, { receiver: 'stopped' }],
      },
    });
  } finally {
    await cleanup({ root, handles });
  }
});
