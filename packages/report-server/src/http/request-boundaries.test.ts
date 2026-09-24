import { afterEach, expect, test } from 'vitest';
import { request } from 'node:http';
import { startReportServer } from '../index.js';
import { fixtureProvider } from '../test-fixtures/provider.js';
import type { ReportServer } from '../model/server.js';

const servers: ReportServer[] = [];

function requestHeaders(headers: Record<string, string>): Record<string, string> {
  return headers;
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

async function setup() {
  const fixture = fixtureProvider();
  const server = await startReportServer({
    kind: 'start-report-server',
    port: 0,
    selection: { kind: 'registry' },
    providers: [fixture.provider],
  });
  servers.push(server);
  return { ...fixture, server };
}

function rawRequest(input: { port: number; path: string; headers: Record<string, string> }) {
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const outgoing = request(
      { hostname: '127.0.0.1', port: input.port, path: input.path, headers: input.headers },
      (response) => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk: string) => {
          body += chunk;
        });
        response.on('end', () => {
          if (response.statusCode === undefined) {
            reject(new Error('HTTP response ended without a status code'));
            return;
          }
          resolve({ status: response.statusCode, body });
        });
      },
    );
    outgoing.on('error', reject);
    outgoing.end();
  });
}

test('raw traversal, malformed encoding, and invalid request targets never invoke providers', async () => {
  const { server, calls } = await setup();
  const paths = [
    '//api/reports',
    'http://attacker.example/api/reports',
    '/api//reports',
    '/api/reports/capsule/..',
    '/api/reports/capsule/%2e%2e',
    '/api/reports/capsule/.',
    '/api/reports/capsule/%',
    '/api/reports/capsule/%2fsecret',
    '/api/reports/capsule/exact-one/',
    `/api/reports/capsule/${'a'.repeat(201)}`,
  ];
  for (const path of paths) {
    const result = await rawRequest({ port: server.port, path, headers: {} });
    expect(result.status, path).toBe(400);
    expect(JSON.parse(result.body).code).toBe('invalid-request');
  }
  expect(calls).toEqual([]);
});

test('unknown route shapes do not fall through to loading a report', async () => {
  const { server, calls } = await setup();
  for (const path of [
    '/elsewhere',
    '/api/other',
    '/reports',
    '/reports/capsule',
    '/reports/capsule/exact-one/extra',
    '/api/reports/capsule/exact-one/extra',
    '/api/reports/capsule/exact-one/artifacts',
  ]) {
    expect((await rawRequest({ port: server.port, path, headers: {} })).status, path).toBe(404);
  }
  expect(calls).toEqual([]);
});

test('requires exact local Host and Origin and accepts its own origin', async () => {
  const { server, calls } = await setup();
  const origin = new URL(server.url).origin;
  const rejectedHeaders = [
    requestHeaders({ host: `localhost:${server.port}` }),
    requestHeaders({ host: '127.0.0.1:1' }),
    requestHeaders({ origin: 'null' }),
    requestHeaders({ origin: `${origin}/` }),
    requestHeaders({ origin: origin.replace('http:', 'https:') }),
  ];
  for (const headers of rejectedHeaders) {
    expect((await rawRequest({ port: server.port, path: '/api/reports', headers })).status).toBe(
      403,
    );
  }
  expect(calls).toEqual([]);
  const allowed = await fetch(`${origin}/api/reports`, { headers: { origin } });
  expect(allowed.status).toBe(200);
  expect(calls).toEqual(['list']);
});

test('HEAD retains success and failure status and headers without exposing response bodies', async () => {
  const { server, calls } = await setup();
  for (const [path, status, contentType] of [
    ['reports/capsule/exact-one', 200, 'text/html'],
    ['api/reports/capsule/missing', 404, 'application/json'],
    ['api/reports/capsule/corrupt', 500, 'application/json'],
    ['api/reports/capsule/exact-one/artifacts/secrets.json', 422, 'application/json'],
  ] as const) {
    const result = await fetch(`${server.url}${path}`, { method: 'HEAD' });
    expect(result.status).toBe(status);
    expect(result.headers.get('content-type')).toContain(contentType);
    expect(result.headers.get('x-content-type-options')).toBe('nosniff');
    expect(await result.text()).toBe('');
  }
  expect(calls).toEqual([
    'load:exact-one',
    'render',
    'load:missing',
    'load:corrupt',
    'artifact:exact-one:secrets.json',
  ]);
});

test('rejects each write verb without calling any provider', async () => {
  const { server, calls } = await setup();
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
    const result = await fetch(`${server.url}api/reports/capsule/exact-one`, { method });
    expect(result.status).toBe(405);
    expect((await result.json()).code).toBe('invalid-request');
  }
  expect(calls).toEqual([]);
});
