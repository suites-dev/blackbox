import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  ComposeContainer,
  SandboxInput,
  SandboxStartInput,
  StartedComposeSandbox,
} from '../types.js';

export interface SandboxFixture {
  readonly root: string;
  readonly input: SandboxInput;
}

export async function sandboxFixture(): Promise<SandboxFixture> {
  const root = await mkdtemp(join(tmpdir(), 'blackbox-sandbox-'));
  await mkdir(join(root, 'catalog'));
  await writeFile(join(root, 'catalog', 'compose.yaml'), 'services: {}\n');
  return {
    root,
    input: {
      sandboxId: 'orders-01',
      projectDirectory: root,
      composeFiles: ['catalog/compose.yaml'],
      recordDirectory: join(root, 'records'),
      environment: { MODE: 'test' },
      serviceSelection: { kind: 'selected', services: ['orders'] },
      endpoints: [{ name: 'http', service: 'orders', containerPort: 3000 }],
      startupTimeoutMs: 5_000,
      stopTimeoutMs: 500,
      telemetry: { kind: 'disabled' },
    },
  };
}

export function composeContainer(): ComposeContainer {
  return {
    id: 'container-id',
    name: 'orders-1',
    host: '127.0.0.1',
    labels: { 'com.docker.compose.project': 'orders-project' },
    networkNames: ['orders_default'],
    getMappedPort(input) {
      return input.containerPort + 10_000;
    },
  };
}

export function startedSandbox(input: {
  readonly stop: (request: { readonly timeoutMs: number }) => Promise<void>;
}): StartedComposeSandbox {
  return {
    getContainer(request) {
      if (request.service !== 'orders') {
        throw new Error(`unknown service: ${request.service}`);
      }
      return composeContainer();
    },
    execute: () => Promise.reject(new Error('unexpected container execution')),
    inspectResources: (request) =>
      Promise.resolve({
        kind: 'owned-compose-resources',
        projectName: request.projectName,
        networks: [
          {
            id: 'network-id',
            name: `${request.projectName}_default`,
            labels: { 'com.docker.compose.project': request.projectName },
          },
        ],
        volumes: [
          {
            name: `${request.projectName}_data`,
            labels: { 'com.docker.compose.project': request.projectName },
          },
        ],
      }),
    inspectTelemetry: () => Promise.resolve({ kind: 'disabled' }),
    prepareStop: () => Promise.resolve(),
    stop: input.stop,
  };
}

export function silentStart(sandbox: SandboxInput): SandboxStartInput {
  return { sandbox, progress: { kind: 'silent' } };
}

export function deterministicClock(): () => Date {
  let tick = 0;
  return () => new Date(Date.UTC(2026, 0, 1, 0, 0, tick++));
}
