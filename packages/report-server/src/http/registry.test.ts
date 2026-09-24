import { expect, test } from 'vitest';
import { listRegistry } from './registry.js';
import { fixtureProvider } from '../test-fixtures/provider.js';
import { startReportServer } from './server.js';

test('keeps successful providers and makes partial registry failure explicit', async () => {
  const { provider } = fixtureProvider();
  const result = await listRegistry({
    providers: [
      provider,
      {
        ...provider,
        type: 'broken',
        list() {
          throw new Error('/private/secret');
        },
      },
    ],
  });
  expect(result.reports).toHaveLength(2);
  expect(result.failures).toEqual([
    {
      type: 'broken',
      failure: {
        kind: 'report-failure',
        code: 'provider-error',
        message: 'The report provider could not read the requested records.',
      },
    },
  ]);
  expect(JSON.stringify(result)).not.toContain('/private/secret');
});

test('preserves provider unavailable state rather than returning empty success', async () => {
  const { provider } = fixtureProvider();
  const result = await listRegistry({
    providers: [
      {
        ...provider,
        list() {
          return Promise.resolve({
            kind: 'report-failure',
            code: 'artifact-unavailable',
            message: 'Corrupt registry input.',
          } as const);
        },
      },
    ],
  });
  expect(result.reports).toEqual([]);
  expect(result.failures[0].failure.code).toBe('artifact-unavailable');
});

test('supports initial exact selection and reports bind conflicts', async () => {
  const { provider } = fixtureProvider();
  const config = {
    kind: 'start-report-server',
    port: 0,
    selection: { kind: 'report', type: 'capsule', id: 'exact-two' },
    providers: [provider],
  } as const;
  const server = await startReportServer(config);
  try {
    expect(new URL(server.url).searchParams.get('id')).toBe('exact-two');
    await expect(startReportServer({ ...config, port: server.port })).rejects.toMatchObject({
      code: 'EADDRINUSE',
    });
    const registry = await fetch(`${new URL(server.url).origin}/api/reports/capsule`);
    expect((await registry.json()).reports).toHaveLength(2);
  } finally {
    await server.close();
  }
});
