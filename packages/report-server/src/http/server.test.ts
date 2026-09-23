import { afterEach, expect, test } from 'vitest';
import { get } from 'node:http';
import { startReportServer } from './server.js';
import { fixtureProvider } from '../test-fixtures/provider.js';
import type { ReportServer } from '../model/server.js';

const servers: ReportServer[] = [];
afterEach(async () => { await Promise.all(servers.splice(0).map(server => server.close())); });

async function setup() {
  const fixture = fixtureProvider();
  const server = await startReportServer({ kind: 'start-report-server', port: 0, selection: { kind: 'registry' }, providers: [fixture.provider] });
  servers.push(server);
  return { ...fixture, server };
}

function hostileHost(input: { url: string }): Promise<number | undefined> {
  return new Promise((resolve, reject) => {
    get(input.url, { headers: { host: 'attacker.example' } }, response => {
      response.resume();
      response.on('end', () => { resolve(response.statusCode); });
    }).on('error', reject);
  });
}

test('serves a registry without eagerly loading reports or artifacts', async () => {
  const { server, calls } = await setup();
  expect(server.hostname).toBe('127.0.0.1');
  const shell = await fetch(server.url);
  expect(await shell.text()).toContain('Select an exact session');
  expect(calls).toEqual([]);
  const listing = await fetch(`${server.url}api/reports`);
  const result = await listing.json();
  expect(result.kind).toBe('report-registry');
  expect(result.reports.map((report: {id: string}) => report.id)).toEqual(['exact-one', 'exact-two']);
  expect(calls).toEqual(['list']);
  expect(listing.headers.get('cache-control')).toBe('no-store');
});

test('loads exact reports, renders through provider, and loads artifacts on demand', async () => {
  const { server, calls } = await setup();
  const json = await fetch(`${server.url}api/reports/capsule/exact-two`);
  expect(await json.json()).toEqual({ kind: 'report-document', document: { id: 'exact-two', title: 'Orders' } });
  expect(calls).toEqual(['load:exact-two']);
  const html = await fetch(`${server.url}reports/capsule/exact-one`);
  expect(await html.text()).toContain('Shared renderer');
  const artifact = await fetch(`${server.url}api/reports/capsule/exact-one/artifacts/activities.json`);
  expect(await artifact.json()).toEqual({ kind: 'report-artifact', artifact: 'activities.json', document: [] });
  expect(calls).toEqual(['load:exact-two', 'load:exact-one', 'render', 'artifact:exact-one:activities.json']);
});

test('returns explicit missing, unavailable, and provider-error outcomes', async () => {
  const { server } = await setup();
  expect((await fetch(`${server.url}api/reports/capsule/missing`)).status).toBe(404);
  expect((await fetch(`${server.url}api/reports/unknown/id`)).status).toBe(404);
  expect((await fetch(`${server.url}api/reports/capsule/exact-one/artifacts/secrets.json`)).status).toBe(422);
  const corrupt = await fetch(`${server.url}api/reports/capsule/corrupt`);
  expect(corrupt.status).toBe(500);
  expect(await corrupt.text()).not.toContain('PRIVATE');
});

test('rejects writes, hostile origins, and encoded traversal before provider calls', async () => {
  const { server, calls } = await setup();
  expect((await fetch(`${server.url}api/reports`, { method: 'POST' })).status).toBe(405);
  expect((await fetch(`${server.url}api/reports`, { headers: { origin: 'https://attacker.example' } })).status).toBe(403);
  expect(await hostileHost({ url: `${server.url}api/reports` })).toBe(403);
  for (const path of ['api/reports/capsule/%2e%2e%2fsecret', 'api/reports/capsule/%5csecret', 'api/reports/capsule/%00', 'api/reports/capsule/%FF']) {
    expect((await fetch(`${server.url}${path}`)).status).toBe(400);
  }
  expect(calls).toEqual([]);
});

test('serves HEAD without a body and releases the port on idempotent close', async () => {
  const { server } = await setup();
  const head = await fetch(server.url, { method: 'HEAD' });
  expect(head.status).toBe(200);
  expect(await head.text()).toBe('');
  await server.close();
  await server.close();
  await expect(fetch(server.url)).rejects.toThrow();
  const replacement = await startReportServer({ kind: 'start-report-server', port: server.port, selection: { kind: 'registry' }, providers: [] });
  servers.push(replacement);
});

test('rejects duplicate provider types and invalid initial selection before binding', async () => {
  const { provider } = fixtureProvider();
  const input = { kind: 'start-report-server', port: 0, selection: { kind: 'registry' }, providers: [provider, provider] } as const;
  await expect(startReportServer(input)).rejects.toThrow('unique');
  await expect(startReportServer({ ...input, providers: [provider], port: -1 })).rejects.toThrow('Port');
  await expect(startReportServer({ ...input, providers: [provider], selection: { kind: 'report', type: 'missing', id: 'one' } })).rejects.toThrow('selection');
});
