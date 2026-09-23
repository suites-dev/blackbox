import { once } from 'node:events';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';

import { afterEach, expect, it } from 'vitest';

import { awaitReadiness, runHost } from './commands.js';

const servers: Server[] = [];

afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => { resolve(); }));
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
  if (address === null || typeof address === 'string') { throw new Error('No TCP address'); }
  return {
    requests,
    entrypoint: { host: '127.0.0.1', port: address.port, protocol: 'http' as const, url: `http://127.0.0.1:${address.port}` },
  };
}

it('preserves host argv, environment, streams, and nonzero exit status across a real child', async () => {
  const argv = [process.execPath, '-e', 'process.stdout.write(process.env.BB_TEST_VALUE + ":" + process.argv[1]); process.stderr.write("diagnostic"); process.exitCode = 7;', 'literal;$(not-a-shell)'] as const;
  const result = await runHost({ argv, cwd: tmpdir(), environment: { BB_TEST_VALUE: 'fixture-value' } });
  expect(result).toEqual({
    kind: 'exited', argv: [...argv], exitCode: 7,
    stdout: 'fixture-value:literal;$(not-a-shell)', stderr: 'diagnostic',
  });
});

it('distinguishes a signaled process from a successful exit', async () => {
  const argv = [process.execPath, '-e', 'process.kill(process.pid, "SIGTERM")'] as const;
  await expect(runHost({ argv, cwd: tmpdir(), environment: {} })).resolves.toEqual({
    kind: 'signaled', argv: [...argv], signal: 'SIGTERM', stdout: '', stderr: '',
  });
});

it('rejects spawn failure rather than manufacturing a successful empty process result', async () => {
  await expect(runHost({ argv: ['/nonexistent/blackbox-test-executable'], cwd: tmpdir(), environment: {} }))
    .rejects.toMatchObject({ code: 'ENOENT' });
});

it('retries an unhealthy real endpoint and waits for HTTP success', async () => {
  let attempts = 0;
  const fixture = await readinessServer(() => ++attempts === 1 ? 503 : 204);
  await awaitReadiness({ entrypoint: fixture.entrypoint, path: '/health', timeoutMs: 3000 });
  expect(fixture.requests).toEqual(['/health', '/health']);
});

it('retains the unhealthy HTTP cause when readiness expires', async () => {
  const fixture = await readinessServer(() => 503);
  await expect(awaitReadiness({ entrypoint: fixture.entrypoint, path: '/health', timeoutMs: 100 }))
    .rejects.toMatchObject({ message: 'Readiness did not succeed within 100ms', cause: { message: 'Readiness returned HTTP 503' } });
  expect(fixture.requests).toEqual(['/health']);
});
