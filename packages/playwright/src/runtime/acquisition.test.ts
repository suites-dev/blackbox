import { expect, it } from 'vitest';
import { resolveCatalogEntry, type LoadedCatalog } from '@suites/blackbox-catalog';
import type {
  SandboxHandle,
  SandboxStartInput,
  SandboxStopReason,
  SandboxTelemetryEnabledInput,
} from '@suites/blackbox-sandbox';

import {
  acquireBlackboxAttempt,
  type BlackboxAttemptInput,
  type BlackboxAcquisitionPorts,
} from './acquisition.js';
import { catalog } from '../testing/catalog-fixture.js';

interface RuntimeFixture {
  readonly ports: BlackboxAcquisitionPorts;
  readonly starts: SandboxStartInput[];
  readonly stops: SandboxStopReason[];
  readonly readiness: string[];
}

function sandboxHandle(input: SandboxStartInput, stops: SandboxStopReason[]): SandboxHandle {
  return {
    sandboxId: input.sandbox.sandboxId,
    projectName: `bb-${input.sandbox.sandboxId}`,
    state: 'running',
    declaredEnvironment: input.sandbox.environment,
    endpoints: new Map([
      [
        'entrypoint',
        {
          name: 'entrypoint',
          service: 'api',
          containerPort: 3000,
          host: '127.0.0.1',
          port: 41_001,
        },
      ],
    ]),
    containers: new Map(),
    telemetry: { kind: 'disabled' },
    getContainer() {
      throw new Error('not used by this test');
    },
    inspectResources: () => ({
      kind: 'owned-compose-resources',
      projectName: `bb-${input.sandbox.sandboxId}`,
      containers: [],
      networks: [],
      volumes: [],
    }),
    execute: () => Promise.reject(new Error('not used by this test')),
    startContainerExecution: () => Promise.reject(new Error('not used by this test')),
    inspectTelemetry: () => Promise.resolve({ kind: 'disabled' }),
    stop(request) {
      stops.push(request.reason);
      return Promise.resolve({
        kind: 'stopped',
        sandboxId: input.sandbox.sandboxId,
        reason: request.reason,
        cleanup: 'complete',
      });
    },
  };
}

function telemetry(input: Parameters<BlackboxAcquisitionPorts['createTelemetry']>[0]) {
  return {
    kind: 'enabled',
    sessionId: input.sessionId,
    executionId: input.executionId,
    authorization: input.authorization,
    collector: {
      service: 'collector',
      containerPort: 4318,
      runtime: { kind: 'image-default', image: 'collector:test' },
      environment: {},
      readiness: {
        kind: 'http',
        path: '/ready',
        intervalSeconds: 1,
        timeoutSeconds: 1,
        retries: 1,
      },
      drain: { kind: 'signal', signal: 'SIGTERM' },
    },
    participants: [],
  } satisfies SandboxTelemetryEnabledInput;
}

function runtimeFixture(input: {
  readonly catalog: LoadedCatalog;
  readonly readinessFailure: Error | null;
}): RuntimeFixture {
  const starts: SandboxStartInput[] = [];
  const stops: SandboxStopReason[] = [];
  const readiness: string[] = [];
  const ids = ['session-1', 'execution-1', 'session-2', 'execution-2'];
  const ports = {
    loadCatalog: () => Promise.resolve(input.catalog),
    resolveCatalog: resolveCatalogEntry,
    startSandbox(request) {
      starts.push(request);
      return Promise.resolve(sandboxHandle(request, stops));
    },
    resolveCollectorRuntime: () =>
      Promise.resolve({
        kind: 'image-default' as const,
        image: 'collector:test',
      }),
    createTelemetry: (request) => Promise.resolve(telemetry(request)),
    verifyActivations: () => Promise.resolve(),
    awaitReadiness(request) {
      readiness.push(request.entrypoint.url);
      if (input.readinessFailure !== null) {
        return Promise.reject(input.readinessFailure);
      }
      return Promise.resolve();
    },
    randomId: () => {
      const value = ids.shift();
      if (value === undefined) {
        throw new Error('test identity fixture exhausted');
      }
      return value;
    },
    randomToken: () => 'test-token',
  } satisfies BlackboxAcquisitionPorts;
  return { ports, starts, stops, readiness };
}

function attemptInput(
  selection: BlackboxAttemptInput['selection'],
  environment: Readonly<Record<string, string>> = {},
): BlackboxAttemptInput {
  return {
    selection,
    configFile: '/project/blackbox.config.yaml',
    environment,
    artifactDirectory: '/artifacts/test',
  };
}

it('acquires an independent catalog-selected sandbox for each physical attempt', async () => {
  const fixture = runtimeFixture({ catalog: catalog(), readinessFailure: null });
  const request = attemptInput({ kind: 'system', id: 'orders' }, { DEMO: 'yes' });
  const first = await acquireBlackboxAttempt(request, fixture.ports);
  const second = await acquireBlackboxAttempt(request, fixture.ports);
  expect(first.sandbox.executionId).not.toBe(second.sandbox.executionId);
  expect(fixture.starts).toHaveLength(2);
  expect(fixture.starts[0].sandbox.serviceSelection).toEqual({
    kind: 'selected',
    services: ['api'],
  });
  expect(fixture.starts[0].sandbox.environment).toEqual({ DEMO: 'yes' });
  expect(fixture.readiness).toEqual(['http://127.0.0.1:41001', 'http://127.0.0.1:41001']);
  await first.stop('completed');
  await second.stop('failed');
  expect(fixture.stops).toEqual(['completed', 'failed']);
});

it('rejects a declared system or subsystem kind that contradicts the catalog', async () => {
  const fixture = runtimeFixture({ catalog: catalog('subsystem'), readinessFailure: null });
  await expect(
    acquireBlackboxAttempt(attemptInput({ kind: 'system', id: 'orders' }), fixture.ports),
  ).rejects.toThrow('is "subsystem", not "system"');
  expect(fixture.starts).toHaveLength(0);
});

it('accepts a subsystem when both the test and catalog declare subsystem', async () => {
  const fixture = runtimeFixture({ catalog: catalog('subsystem'), readinessFailure: null });
  const attempt = await acquireBlackboxAttempt(
    attemptInput({ kind: 'subsystem', id: 'orders' }),
    fixture.ports,
  );
  expect(attempt.sandbox.catalogEntry).toMatchObject({ id: 'orders', kind: 'subsystem' });
  await attempt.stop('completed');
});

it('requires an explicit catalog entry selection', async () => {
  const fixture = runtimeFixture({ catalog: catalog(), readinessFailure: null });
  await expect(
    acquireBlackboxAttempt(attemptInput({ kind: 'unselected' }), fixture.ports),
  ).rejects.toThrow('catalog entry is not selected');
  expect(fixture.starts).toHaveLength(0);
});

it('rejects catalog isolation that could share state between tests', async () => {
  const fixture = runtimeFixture({
    catalog: catalog('system', { kind: 'per-worker' }),
    readinessFailure: null,
  });
  await expect(
    acquireBlackboxAttempt(attemptInput({ kind: 'system', id: 'orders' }), fixture.ports),
  ).rejects.toThrow('requires catalog isolation kind "per-test"');
  expect(fixture.starts).toHaveLength(0);
});

it('stops an acquired sandbox when readiness fails before the test body', async () => {
  const fixture = runtimeFixture({
    catalog: catalog(),
    readinessFailure: new Error('application not ready'),
  });
  await expect(
    acquireBlackboxAttempt(attemptInput({ kind: 'system', id: 'orders' }), fixture.ports),
  ).rejects.toThrow('application not ready');
  expect(fixture.stops).toEqual(['failed']);
});
