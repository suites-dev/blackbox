import { once } from 'node:events';
import { createServer } from 'node:http';

import { resolveCatalogEntry } from '@suites/blackbox-catalog-internal';
import type { SandboxHandle, SandboxStartInput } from '@suites/blackbox-sandbox-internal';
import { expect, it } from 'vitest';

import { runCapsuleManager } from '../../manager.js';
import { managerRequest } from '../../ipc/client.js';
import { readCapsuleProgress } from '../../progress/store.js';
import { readCapsuleRecord } from '../../records.js';
import { catalogFixture, readyCollectorRuntime } from './acquisition.fixture.js';
import { requestFixture } from './request.fixture.js';

function startWithEvents(input: { start: SandboxStartInput; sandbox: SandboxHandle }) {
  const base = {
    sandboxId: input.sandbox.sandboxId,
    projectName: input.sandbox.projectName,
    at: new Date().toISOString(),
  };
  if (input.start.progress.kind !== 'events') {
    throw new Error('Capsule must request lifecycle events');
  }
  input.start.progress.sink.emit({ ...base, kind: 'acquisition-started' });
  input.start.progress.sink.emit({
    ...base,
    kind: 'containers-acquired',
    containers: [input.sandbox.getContainer({ service: 'api' })],
  });
  input.start.progress.sink.emit({
    ...base,
    kind: 'resources-ready',
    resources: input.sandbox.inspectResources({ kind: 'owned-compose-resources' }),
  });
  return Promise.resolve(input.sandbox);
}

function expectCollectorRuntime(start: SandboxStartInput): void {
  expect(start.sandbox.telemetry).toMatchObject({
    kind: 'enabled',
    collector: {
      service: 'blackbox-otel-collector',
      runtime: { kind: 'image-default', image: 'collector:test' },
    },
  });
}

async function listenForHealth(status: number) {
  const server = createServer((_request, response) => {
    response.writeHead(status).end();
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('Missing health address');
  }
  return { port: address.port, server };
}

function observedSandbox(base: SandboxHandle, port: number): SandboxHandle {
  return {
    ...base,
    endpoints: new Map([
      [
        'entrypoint',
        { name: 'entrypoint', service: 'api', containerPort: 3000, host: '127.0.0.1', port },
      ],
    ]),
    getContainer: () => ({
      service: 'api',
      testcontainer: {
        id: 'owned-container',
        name: 'owned-api',
        host: '127.0.0.1',
        labels: {},
        environment: {},
        networkNames: [],
        mappedPorts: new Map(),
        getMappedPort: () => port,
      },
    }),
    inspectResources: () => ({
      kind: 'owned-compose-resources',
      projectName: 'test-compose',
      containers: [],
      networks: [{ kind: 'network', name: 'owned-network', id: 'network-id', labels: {} }],
      volumes: [{ kind: 'volume', name: 'owned-volume', labels: {} }],
    }),
  };
}

it.each([204, 503])(
  'manages acquisition and cleanup truthfully with readiness HTTP %i',
  async (status) => {
    const stopped: string[] = [];
    const fixture = await requestFixture((input) => {
      stopped.push(input.reason);
      return Promise.resolve();
    });
    await new Promise<void>((resolve) =>
      fixture.manager.server.close(() => {
        resolve();
      }),
    );
    const health = await listenForHealth(status);
    try {
      const sandbox = observedSandbox(fixture.manager.sandbox, health.port);
      await runCapsuleManager(fixture, {
        collectorRuntime: readyCollectorRuntime,
        catalog: {
          load: () => Promise.resolve(catalogFixture(fixture.projectDirectory)),
          resolve: ({ catalog, systemId }) =>
            resolveCatalogEntry({
              catalog,
              selection: { kind: 'explicit-entry', entryId: systemId },
            }),
        },
        sandbox: {
          projectName: () => 'test-compose',
          start: (start) => {
            expectCollectorRuntime(start);
            return startWithEvents({ start, sandbox });
          },
        },
        now: () => new Date(),
      });
      const retained = await readCapsuleRecord(fixture);
      if (status === 204) {
        expect(retained).toMatchObject({
          state: 'running',
          readiness: { kind: 'available', value: { status: 'ready' } },
          containers: [{ participant: 'api', containerId: 'owned-container' }],
          networks: ['owned-network'],
          volumes: ['owned-volume'],
        });
        const progress = await readCapsuleProgress(fixture);
        expect(
          progress.filter(({ kind }) => kind === 'container-acquired' || kind === 'resource-owned'),
        ).toMatchObject([
          { kind: 'container-acquired', participant: 'api', containerId: 'owned-container' },
          { kind: 'resource-owned', resource: { kind: 'network', name: 'owned-network' } },
          { kind: 'resource-owned', resource: { kind: 'volume', name: 'owned-volume' } },
        ]);
        expect(progress.at(-1)).toMatchObject({ kind: 'capsule-ready' });
        await expect(
          managerRequest({
            socketPath: fixture.socketPath,
            request: { kind: 'stop-request', requestId: 'done', reason: 'completed' },
          }),
        ).resolves.toMatchObject({ kind: 'stop-response', cleanup: 'complete' });
        expect(stopped).toEqual(['completed']);
      } else {
        expect(retained).toMatchObject({
          state: 'start-failed',
          failure: {
            kind: 'recorded',
            error: { message: expect.stringContaining('Readiness') },
          },
        });
        expect(stopped).toEqual(['failed']);
        expect(retained.cleanup).toEqual({ kind: 'complete' });
      }
    } finally {
      health.server.closeAllConnections();
      await new Promise<void>((resolve) =>
        health.server.close(() => {
          resolve();
        }),
      );
      await fixture.close();
    }
  },
);
