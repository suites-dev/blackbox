import { resolveCatalogEntry } from '@suites/blackbox-catalog-internal';
import { expect, it } from 'vitest';

import { capsuleSandboxTelemetry } from './telemetry.js';
import {
  collectorContainerUser,
  nodeCapsuleCollectorRuntime,
  requireCollectorRuntime,
  type CapsuleCollectorRuntimeReadiness,
} from './collector-runtime.js';
import { catalogFixture } from './testing/acquisition.fixture.js';

it('uses a packaged collector on an immutable multi-architecture Node image', async () => {
  const readiness = await nodeCapsuleCollectorRuntime.resolve();
  expect(readiness.kind).toBe('ready');
  const runtime = requireCollectorRuntime(readiness);
  expect(runtime.kind).toBe('mounted-node');
  expect(runtime.image).toMatch(/^docker\.io\/library\/node:22-alpine@sha256:[a-f0-9]{64}$/u);
  expect(runtime.image).not.toContain(':dev');
  if (runtime.kind === 'mounted-node') {
    expect(runtime.sourceDirectory).toMatch(/otel-collector\/dist$/u);
    expect(runtime.entrypoint).toBe('main.js');
    if (process.getuid === undefined || process.getgid === undefined) {
      expect(runtime.user).toBe('node');
    } else {
      expect(runtime.user).toBe(`${process.getuid()}:${process.getgid()}`);
    }
  }
});

it('selects a writable collector identity for POSIX and non-POSIX hosts', () => {
  expect(
    collectorContainerUser({ kind: 'posix', userId: 1001, groupId: 121 }),
  ).toBe('1001:121');
  expect(collectorContainerUser({ kind: 'non-posix' })).toBe('node');
});

it('keeps a local image override explicit at the manager composition boundary', () => {
  const catalog = catalogFixture('/tmp/blackbox-project');
  const plan = resolveCatalogEntry({
    catalog,
    selection: { kind: 'explicit-entry', entryId: 'orders' },
  });
  const collectorRuntime = { kind: 'image-default', image: 'collector:e2e' } as const;
  const telemetry = capsuleSandboxTelemetry({
    bootstrap: {
      projectDirectory: catalog.projectDirectory,
      sessionId: 'session-1',
      executionId: 'execution-1',
      systemId: 'orders',
      environment: {},
    },
    plan,
    authorization: {
      kind: 'split-bearer-tokens',
      ingestToken: 'ingest-secret',
      controlToken: 'control-secret',
    },
    collectorRuntime,
  });
  expect(telemetry.collector.runtime).toEqual(collectorRuntime);
});

it('turns unavailable packaged runtime readiness into an acquisition failure', () => {
  const readiness = {
    kind: 'unavailable',
    error: { name: 'CollectorRuntimeUnavailable', message: 'main.js is missing' },
  } satisfies CapsuleCollectorRuntimeReadiness;
  expect(() => requireCollectorRuntime(readiness)).toThrow(
    'CollectorRuntimeUnavailable: main.js is missing',
  );
});
