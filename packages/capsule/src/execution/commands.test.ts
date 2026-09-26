import { once } from 'node:events';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';

import { afterEach, expect, it } from 'vitest';

import { awaitReadiness, runHost, runHostWithInteraction } from './commands.js';
import type { CapsuleInteractiveControl, CapsuleInteractiveEvent } from './types.js';

const servers: Server[] = [];

afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve) =>
      server.close(() => {
        resolve();
      }),
    );
  }
});

async function readinessServer(status: () => number) {
  const requests: string[] = [];
  const server = createServer((request, response) => {
    requests.push(request.url ?? '');
    response.writeHead(status()).end();
  });
  servers.push(server);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('No TCP address');
  }
  return {
    requests,
    entrypoint: {
      host: '127.0.0.1',
      port: address.port,
      protocol: 'http' as const,
      url: `http://127.0.0.1:${address.port}`,
    },
  };
}

it('preserves host argv, environment, streams, and nonzero exit status across a real child', async () => {
  const argv = [
    process.execPath,
    '-e',
    'process.stdout.write(process.env.BB_TEST_VALUE + ":" + process.argv[1]); process.stderr.write("diagnostic"); process.exitCode = 7;',
    'literal;$(not-a-shell)',
  ] as const;
  const result = await runHost({
    argv,
    cwd: tmpdir(),
    environment: { BB_TEST_VALUE: 'fixture-value' },
  });
  expect(result).toEqual({
    kind: 'exited',
    argv: [...argv],
    location: { kind: 'host' },
    exitCode: 7,
    stdout: 'fixture-value:literal;$(not-a-shell)',
    stderr: 'diagnostic',
    retention: {
      stdout: {
        kind: 'complete',
        originalBytes: Buffer.byteLength('fixture-value:literal;$(not-a-shell)'),
      },
      stderr: { kind: 'complete', originalBytes: Buffer.byteLength('diagnostic') },
    },
  });
});

it('distinguishes a signaled process from a successful exit', async () => {
  const argv = [process.execPath, '-e', 'process.kill(process.pid, "SIGTERM")'] as const;
  await expect(runHost({ argv, cwd: tmpdir(), environment: {} })).resolves.toEqual({
    kind: 'signaled',
    argv: [...argv],
    location: { kind: 'host' },
    signal: 'SIGTERM',
    stdout: '',
    stderr: '',
    retention: {
      stdout: { kind: 'complete', originalBytes: 0 },
      stderr: { kind: 'complete', originalBytes: 0 },
    },
  });
});

it('retains a typed failure when the host executable is missing', async () => {
  await expect(
    runHost({ argv: ['/nonexistent/blackbox-test-executable'], cwd: tmpdir(), environment: {} }),
  ).resolves.toMatchObject({
    kind: 'executable-not-found',
    location: { kind: 'host' },
    remediation: expect.stringContaining('Install'),
  });
});

it('streams real host output and reports unsupported terminal resize explicitly', async () => {
  const events: CapsuleInteractiveEvent[] = [];
  async function* controls(): AsyncGenerator<CapsuleInteractiveControl> {
    await Promise.resolve();
    yield { kind: 'resize', controlId: 'resize-1', size: { columns: 120, rows: 40 } };
    yield { kind: 'stdin-chunk', controlId: 'input-1', chunk: Buffer.from('from-stdin') };
    yield { kind: 'stdin-end', controlId: 'end-1' };
  }
  const result = await runHostWithInteraction({
    argv: [
      process.execPath,
      '-e',
      'process.stdin.once("data", value => { process.stdout.write("seen:" + value); process.stderr.write("live-error") })',
    ],
    cwd: tmpdir(),
    environment: {},
    interaction: {
      kind: 'interactive',
      terminal: { columns: 120, rows: 40 },
      controls: controls(),
      onEvent: (event) => {
        events.push(event);
        return Promise.resolve();
      },
    },
  });
  expect(events).toContainEqual({
    kind: 'control-result',
    controlId: 'resize-1',
    result: { kind: 'unsupported', action: 'resize', reason: 'host-pty-unavailable' },
  });
  expect(events).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ kind: 'output', stream: 'stdout' }),
      expect.objectContaining({ kind: 'output', stream: 'stderr' }),
    ]),
  );
  expect(result).toMatchObject({
    kind: 'exited',
    exitCode: 0,
    stdout: 'seen:from-stdin',
    stderr: 'live-error',
  });
});

it('forwards SIGINT to a real interactive host child', async () => {
  let markReady: () => void = () => undefined;
  const ready = new Promise<void>((resolve) => {
    markReady = resolve;
  });
  async function* controls(): AsyncGenerator<CapsuleInteractiveControl> {
    await ready;
    yield { kind: 'signal', controlId: 'signal-1', signal: 'SIGINT' };
  }
  const events: CapsuleInteractiveEvent[] = [];
  const result = await runHostWithInteraction({
    argv: [
      process.execPath,
      '-e',
      'process.on("SIGINT", () => { process.stdout.write("interrupted"); process.exit(0) }); process.stdout.write("ready"); setInterval(() => {}, 1000)',
    ],
    cwd: tmpdir(),
    environment: {},
    interaction: {
      kind: 'interactive',
      terminal: { columns: 80, rows: 24 },
      controls: controls(),
      onEvent: (event) => {
        events.push(event);
        if (event.kind === 'output' && Buffer.from(event.chunk).includes(Buffer.from('ready'))) {
          markReady();
        }
        return Promise.resolve();
      },
    },
  });
  expect(result).toMatchObject({ kind: 'exited', exitCode: 0, stdout: 'readyinterrupted' });
  expect(events).toContainEqual({
    kind: 'control-result',
    controlId: 'signal-1',
    result: { kind: 'delivered', action: 'signal', mechanism: 'host-process-signal' },
  });
});

it('retries an unhealthy real endpoint and waits for HTTP success', async () => {
  let attempts = 0;
  const fixture = await readinessServer(() => (++attempts === 1 ? 503 : 204));
  await awaitReadiness({ entrypoint: fixture.entrypoint, path: '/health', timeoutMs: 3000 });
  expect(fixture.requests).toEqual(['/health', '/health']);
});

it('retains the unhealthy HTTP cause when readiness expires', async () => {
  const fixture = await readinessServer(() => 503);
  await expect(
    awaitReadiness({ entrypoint: fixture.entrypoint, path: '/health', timeoutMs: 100 }),
  ).rejects.toMatchObject({
    message: 'Readiness did not succeed within 100ms',
    cause: { message: 'Readiness returned HTTP 503' },
  });
  expect(fixture.requests).toEqual(['/health']);
});
