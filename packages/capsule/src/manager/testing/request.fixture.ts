import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type {
  SandboxEndpoint,
  SandboxHandle,
  SandboxStopInput,
} from '@suites/blackbox-sandbox-internal';

import { admitCapsuleRecord, type CapsuleSessionRecord } from '../../records.js';
import { serveManager } from '../requests.js';
import type { RunningManager } from '../runtime.js';

function recordFixture(directory: string): CapsuleSessionRecord {
  return {
    schemaVersion: 1,
    sessionId: 'quiet-river-ada',
    executionId: '00000000-0000-4000-8000-000000000001',
    system: 'orders',
    title: 'Orders experiment',
    description: { kind: 'omitted' },
    state: 'running',
    revision: 1,
    admittedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    manager: { kind: 'started', pid: process.pid },
    socketPath: join(directory, 'ipc.sock'),
    entrypoint: {
      kind: 'available',
      value: { url: 'http://127.0.0.1:4567', host: '127.0.0.1', port: 4567, protocol: 'http' },
    },
    containers: [],
    cleanup: { kind: 'not-attempted' },
    failure: { kind: 'none' },
    composeProject: { kind: 'available', value: 'test-compose' },
    artifactRoot: join(directory, '.blackbox/experiments/capsule-quiet-river-ada'),
    networks: [],
    volumes: [],
    readiness: {
      kind: 'available',
      value: { url: 'http://127.0.0.1:4567/health', status: 'ready', durationMs: 1 },
    },
  };
}

function sandboxFixture(input: {
  readonly stop: (request: SandboxStopInput) => Promise<void>;
  readonly environment: Readonly<Record<string, string>>;
}): { readonly sandbox: SandboxHandle; readonly endpoints: Map<string, SandboxEndpoint> } {
  const testcontainer = {
    id: 'api-container', name: 'api-1', host: '127.0.0.1', labels: {},
    environment: { ...input.environment },
    networkNames: [], mappedPorts: new Map<number, number>(), getMappedPort: () => 4567,
  };
  const container = { service: 'api', testcontainer };
  const unused = () => { throw new Error('unused'); };
  const endpoints = new Map<string, SandboxEndpoint>();
  const sandbox = {
    sandboxId: 'test-sandbox', projectName: 'test-compose', state: 'running',
    declaredEnvironment: {}, endpoints,
    containers: new Map([['api', container]]), telemetry: { kind: 'disabled' },
    inspectTelemetry: () => Promise.resolve({ kind: 'disabled' }),
    getContainer: () => container, inspectResources: unused,
    execute: (request) => Promise.resolve({
      kind: 'exited', service: request.service, exitCode: 7,
      stdout: 'participant-output', stderr: 'participant-error', combined: '',
    }),
    startContainerExecution: unused,
    stop: async (request) => {
      await input.stop(request);
      return { kind: 'stopped', sandboxId: 'test-sandbox',
        reason: request.reason, cleanup: 'complete' };
    },
  } satisfies SandboxHandle;
  return { sandbox, endpoints };
}

export async function requestFixture(
  stop: (input: SandboxStopInput) => Promise<void>,
  containerEnvironment: Readonly<Record<string, string>> = {},
) {
  const directory = await mkdtemp(join(tmpdir(), 'bb-manager-'));
  const record = recordFixture(directory);
  await admitCapsuleRecord({ projectDirectory: directory, record });
  const { sandbox, endpoints } = sandboxFixture({ stop, environment: containerEnvironment });
  const server = createServer();
  const bootstrap = {
    projectDirectory: directory,
    sessionId: record.sessionId,
    executionId: record.executionId,
    systemId: 'orders',
    environment: {},
  };
  const manager = {
    server,
    sandbox,
    record,
    activities: [],
    telemetryAuthorization: { kind: 'bearer-token', token: 'test-collector-token' },
    drivers: {},
    entrypoint: { url: 'http://127.0.0.1:4567', host: '127.0.0.1', port: 4567, protocol: 'http' },
  } satisfies RunningManager;
  serveManager(bootstrap, manager);
  server.listen(record.socketPath);
  await once(server, 'listening');
  return {
    ...bootstrap,
    socketPath: record.socketPath,
    manager,
    endpoints,
    close: async () => {
      if (server.listening) {
        await new Promise<void>((resolve) =>
          server.close(() => {
            resolve();
          }),
        );
      }
      await rm(directory, { recursive: true, force: true });
    },
  };
}
