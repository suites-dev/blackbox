import { afterEach, expect, test } from 'vitest';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { ensureReportServer } from './ensure.js';
import type { EnsureReportServerInput, EnsureReportServerResult } from '../model/identity.js';
import { fixtureProvider } from '../test-fixtures/provider.js';

const close: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(close.splice(0).map((stop) => stop()));
});

function input(): EnsureReportServerInput {
  return {
    kind: 'ensure-report-server',
    scopeId: 'project-a',
    port: 0,
    selection: { kind: 'registry' },
    providers: [fixtureProvider().provider],
  };
}

async function owned(config: EnsureReportServerInput) {
  const result = await ensureReportServer(config);
  if (result.kind !== 'report-server-started') {
    throw new Error('Expected an owned listener.');
  }
  close.push(() => result.server.close());
  return result.server;
}

test('reuses the same project listener with exact selection and grants no shutdown capability', async () => {
  const config = input();
  const server = await owned(config);
  const result = await ensureReportServer({
    ...config,
    port: server.port,
    selection: { kind: 'report', type: 'capsule', id: 'exact-two' },
  });
  expect(result).toEqual({
    kind: 'report-server-reused',
    hostname: '127.0.0.1',
    port: server.port,
    url: `http://127.0.0.1:${server.port}/?type=capsule&id=exact-two`,
  });
  expect('close' in result).toBe(false);
  const metadata = await (await fetch(`${server.url}api/server`)).json();
  expect(metadata).toEqual({
    kind: 'report-server-identity',
    schemaVersion: 1,
    scopeId: config.scopeId,
    providerTypes: ['capsule'],
  });
  expect((await fetch(`${server.url}api/reports`)).status).toBe(200);
  await server.close();
  const replacement = await owned({ ...config, port: server.port });
  expect(replacement.port).toBe(server.port);
});

test('concurrent callers elect exactly one listener owner', async () => {
  const config = input();
  const reservation = await owned(config);
  const port = reservation.port;
  await reservation.close();
  const results: EnsureReportServerResult[] = await Promise.all(
    Array.from({ length: 6 }, async () => {
      const result = await ensureReportServer({ ...config, port });
      if (result.kind === 'report-server-started') {
        close.push(() => result.server.close());
      }
      return result;
    }),
  );
  expect(results.filter((result) => result.kind === 'report-server-started')).toHaveLength(1);
  expect(results.filter((result) => result.kind === 'report-server-reused')).toHaveLength(5);
  expect((await fetch(`http://127.0.0.1:${port}/api/reports`)).status).toBe(200);
});

test('a different project or provider set cannot reuse or stop an existing viewer', async () => {
  const config = input();
  const server = await owned(config);
  await expect(
    ensureReportServer({ ...config, port: server.port, scopeId: 'project-b' }),
  ).rejects.toThrow('occupied');
  await expect(ensureReportServer({ ...config, port: server.port, providers: [] })).rejects.toThrow(
    'occupied',
  );
  expect((await fetch(server.url)).status).toBe(200);
  await expect(
    ensureReportServer({
      ...config,
      port: server.port,
      selection: { kind: 'report', type: 'unknown', id: 'id' },
    }),
  ).rejects.toThrow('Initial report selection');
});

async function foreignServer(response: { kind: 'body'; value: string } | { kind: 'hung' }) {
  const server = createServer((_request, outgoing) => {
    if (response.kind === 'body') {
      outgoing.end(response.value);
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  close.push(
    () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
          } else {
            resolve();
          }
        });
        server.closeAllConnections();
      }),
  );
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('No foreign test port.');
  }
  return { port: address.port, server };
}

test.each([
  'not JSON',
  'null',
  '{}',
  JSON.stringify({
    kind: 'report-server-identity',
    schemaVersion: 2,
    scopeId: 'project-a',
    providerTypes: ['capsule'],
  }),
  JSON.stringify({
    kind: 'report-server-identity',
    schemaVersion: 1,
    scopeId: 'project-a',
    providerTypes: 'capsule',
  }),
  JSON.stringify({
    kind: 'report-server-identity',
    schemaVersion: 1,
    scopeId: 'project-a',
    providerTypes: ['other'],
  }),
])('does not reuse an unrecognized listener: %s', async (body) => {
  const { port, server } = await foreignServer({ kind: 'body', value: body });
  await expect(ensureReportServer({ ...input(), port })).rejects.toThrow(
    `Report port ${port} is occupied`,
  );
  expect(server.listening).toBe(true);
});

test('an unresponsive occupied listener produces a bounded conflict without a fallback port', async () => {
  const { port, server } = await foreignServer({ kind: 'hung' });
  await expect(ensureReportServer({ ...input(), port })).rejects.toThrow('No new port was opened');
  expect(server.listening).toBe(true);
});

test('rejects invalid scope and bind inputs instead of treating them as reusable', async () => {
  await expect(ensureReportServer({ ...input(), scopeId: '/private/project' })).rejects.toThrow(
    'opaque identifier',
  );
  await expect(ensureReportServer({ ...input(), port: -1 })).rejects.toThrow('Port');
});
