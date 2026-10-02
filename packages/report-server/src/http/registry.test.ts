import { expect, test } from 'vitest';
import { reportRegistrySchema } from '../index.js';
import { listRegistry } from './registry.js';
import { fixtureProvider } from '../test-fixtures/provider.js';
import { startReportServer } from './server.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// eslint-disable-next-line complexity -- test oracle that hand-checks the exported registry JSON schema field by field, independent of the validator under test
function matchesExportedRegistrySchema(document: unknown): boolean {
  if (
    reportRegistrySchema.type !== 'object' ||
    typeof document !== 'object' ||
    document === null ||
    Array.isArray(document)
  ) {
    return false;
  }
  for (const property of reportRegistrySchema.required) {
    if (!(property in document)) {
      return false;
    }
  }
  if (
    !('kind' in document) ||
    !('schemaVersion' in document) ||
    !('reports' in document) ||
    !('failures' in document) ||
    Object.keys(document).some((property) => !reportRegistrySchema.required.includes(property)) ||
    document.kind !== reportRegistrySchema.properties.kind.const ||
    document.schemaVersion !== reportRegistrySchema.properties.schemaVersion.const ||
    !Array.isArray(document.reports) ||
    !Array.isArray(document.failures)
  ) {
    return false;
  }
  return (
    document.reports.every((report) => {
      if (
        !isRecord(report) ||
        Object.keys(report).some((property) =>
          !reportRegistrySchema.properties.reports.items.required.includes(property),
        )
      ) {
        return false;
      }
      const description = report.description;
      return (
        report.kind === 'report-summary' &&
        typeof report.id === 'string' &&
        typeof report.type === 'string' &&
        typeof report.title === 'string' &&
        typeof report.state === 'string' &&
        typeof report.createdAt === 'string' &&
        isRecord(description) &&
        ((description.kind === 'unavailable' && Object.keys(description).length === 1) ||
          (description.kind === 'available' &&
            typeof description.value === 'string' &&
            Object.keys(description).length === 2))
      );
    }) &&
    document.failures.every((failure) => {
      if (
        !isRecord(failure) ||
        Object.keys(failure).some((property) =>
          !reportRegistrySchema.properties.failures.items.required.includes(property),
        )
      ) {
        return false;
      }
      const detail = failure.failure;
      return (
        typeof failure.type === 'string' &&
        isRecord(detail) &&
        Object.keys(detail).every((property) => ['kind', 'code', 'message'].includes(property)) &&
        detail.kind === 'report-failure' &&
        typeof detail.code === 'string' &&
        ['not-found', 'invalid-request', 'artifact-unavailable', 'provider-error'].includes(detail.code) &&
        typeof detail.message === 'string'
      );
    })
  );
}

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

test('audit M4: rejects malformed summaries against the exported registry schema', async () => {
  const { provider } = fixtureProvider();
  const server = await startReportServer({
    kind: 'start-report-server',
    port: 0,
    selection: { kind: 'registry' },
    providers: [
      {
        ...provider,
        list() {
          return Promise.resolve({
            kind: 'report-list',
            reports: [
              {
                kind: 'report-summary',
                id: 'exact-one',
                type: 'capsule',
                title: 'Wrong provider',
                description: { kind: 'unavailable' },
                state: 'stopped',
                createdAt: '2026-09-25T10:00:00Z',
                unexpected: true,
              },
            ],
          });
        },
      },
    ],
  });
  try {
    const response = await fetch(`${server.url}api/reports`);
    const document: unknown = await response.json();
    expect(matchesExportedRegistrySchema(document)).toBe(true);
    if (typeof document !== 'object' || document === null || !('reports' in document)) {
      throw new Error('Expected a report registry response.');
    }
    expect(document.reports).toEqual([]);
  } finally {
    await server.close();
  }
});

test('audit M4: rejects summaries owned by another provider type', async () => {
  const { provider } = fixtureProvider();
  const server = await startReportServer({
    kind: 'start-report-server',
    port: 0,
    selection: { kind: 'registry' },
    providers: [
      {
        ...provider,
        list() {
          return Promise.resolve({
            kind: 'report-list',
            reports: [
              {
                kind: 'report-summary',
                id: 'wrong-owner',
                type: 'other',
                title: 'Wrong provider',
                description: { kind: 'unavailable' },
                state: 'stopped',
                createdAt: '2026-09-25T10:00:00Z',
              },
            ],
          });
        },
      },
    ],
  });
  try {
    const response = await fetch(`${server.url}api/reports`);
    const document: unknown = await response.json();
    expect(matchesExportedRegistrySchema(document)).toBe(true);
    if (typeof document !== 'object' || document === null || !('reports' in document)) {
      throw new Error('Expected a report registry response.');
    }
    expect(document.reports).toEqual([]);
  } finally {
    await server.close();
  }
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
