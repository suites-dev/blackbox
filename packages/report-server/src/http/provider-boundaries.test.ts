import { afterEach, expect, test } from 'vitest';
import { get } from 'node:http';
import { startReportServer } from '../index.js';
import { fixtureProvider } from '../test-fixtures/provider.js';
import type { ReportProvider } from '../model/provider.js';
import type { ReportServer } from '../model/server.js';

const servers: ReportServer[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

async function setup(input: { provider: ReportProvider }) {
  const server = await startReportServer({
    kind: 'start-report-server',
    port: 0,
    selection: { kind: 'registry' },
    providers: [input.provider],
  });
  servers.push(server);
  return server;
}

test('lazy artifact and renderer exceptions are contained and a later registry request still works', async () => {
  const { provider, calls } = fixtureProvider();
  const server = await setup({
    provider: {
      ...provider,
      artifact() {
        throw new Error('PRIVATE artifact failure');
      },
      render() {
        throw new Error('PRIVATE renderer failure');
      },
    },
  });
  for (const path of [
    'api/reports/capsule/exact-one/artifacts/activities.json',
    'reports/capsule/exact-one',
  ]) {
    const result = await fetch(`${server.url}${path}`);
    expect(result.status).toBe(500);
    expect(await result.json()).toEqual({
      kind: 'report-failure',
      code: 'provider-error',
      message: 'The report provider could not read the requested records.',
    });
  }
  expect(calls).toEqual(['load:exact-one']);
  expect((await fetch(`${server.url}api/reports`)).status).toBe(200);
  expect(calls).toEqual(['load:exact-one', 'list']);
});

test('serializing an invalid provider document fails explicitly rather than dropping the connection', async () => {
  const { provider } = fixtureProvider();
  const server = await setup({
    provider: {
      ...provider,
      load() {
        return Promise.resolve({ kind: 'report-document', document: { cannotSerialize: 1n } });
      },
    },
  });
  const result = await fetch(`${server.url}api/reports/capsule/exact-one`);
  expect(result.status).toBe(500);
  expect((await result.json()).code).toBe('provider-error');
});

test('provider invalid-request failures preserve 400 status and diagnostic message', async () => {
  const { provider } = fixtureProvider();
  const server = await setup({
    provider: {
      ...provider,
      artifact() {
        return Promise.resolve({
          kind: 'report-failure',
          code: 'invalid-request',
          message: 'Artifact name is not supported.',
        });
      },
    },
  });
  const result = await fetch(`${server.url}api/reports/capsule/exact-one/artifacts/unknown.json`);
  expect(result.status).toBe(400);
  expect((await result.json()).message).toBe('Artifact name is not supported.');
});

test('close terminates an active request even when its provider has not resolved', async () => {
  const { provider } = fixtureProvider();
  let admitted = () => {
    /* Replaced synchronously by the promise executor. */
  };
  const started = new Promise<void>((resolve) => {
    admitted = resolve;
  });
  const server = await setup({
    provider: {
      ...provider,
      load() {
        admitted();
        return new Promise(() => {
          /* Model a provider that never resolves. */
        });
      },
    },
  });
  const outcome = new Promise<string>((resolve) => {
    get(`${server.url}api/reports/capsule/exact-one`, (response) => {
      response.resume();
      response.on('end', () => {
        resolve('unexpected-response');
      });
    }).on('error', (error) => {
      resolve(error.message);
    });
  });
  await started;
  const closing = server.close();
  expect(server.close()).toBe(closing);
  await closing;
  expect(await outcome).toBe('socket hang up');
  const replacement = await startReportServer({
    kind: 'start-report-server',
    port: server.port,
    selection: { kind: 'registry' },
    providers: [],
  });
  servers.push(replacement);
});
