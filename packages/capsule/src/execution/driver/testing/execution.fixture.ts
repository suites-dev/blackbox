import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ResolvedCatalogDriver } from '@suites/blackbox-catalog-internal';
import type { SandboxHandle } from '@suites/blackbox-sandbox-internal';
import { createTelemetryExecutionScope } from '@suites/blackbox-telemetry-internal';
import type { CapsuleExecutionControl } from '../../types.js';

const roots: string[] = [];
async function* noControls(): AsyncGenerator<CapsuleExecutionControl> {
  await Promise.resolve();
  yield* [];
}

export const httpDriver = {
  id: 'http',
  kind: 'project-driver',
  runtime: 'node',
  ref: '.blackbox/drivers/http.mjs',
  target: {
    kind: 'participant',
    participantId: 'api',
    service: 'api',
    protocol: 'http',
    containerPort: 3000,
  },
  execution: { kind: 'host' },
  propagation: { kind: 'w3c-trace-context-propagation', carrier: 'http-headers' },
} satisfies ResolvedCatalogDriver;

export function driverSandbox(environment: Readonly<Record<string, string>> = {}): SandboxHandle {
  const testcontainer = Object.freeze({
    id: 'api-container',
    name: 'api-1',
    host: '127.0.0.1',
    labels: Object.freeze({}),
    environment: Object.freeze({ ...environment }),
    networkNames: Object.freeze(['project_default']),
    mappedPorts: new Map<number, number>(),
    getMappedPort: () => 4321,
  });
  const container = Object.freeze({ service: 'api', testcontainer });
  const unused = () => {
    throw new Error('unused');
  };
  return {
    sandboxId: 'sandbox',
    projectName: 'project',
    state: 'running',
    declaredEnvironment: {},
    endpoints: new Map([
      [
        'driver-http',
        { name: 'driver-http', service: 'api', containerPort: 3000, host: '127.0.0.1', port: 4321 },
      ],
    ]),
    containers: new Map([['api', container]]),
    telemetry: { kind: 'disabled' },
    getContainer: ({ service }) => {
      if (service !== 'api') {
        throw new Error(`unknown service: ${service}`);
      }
      return container;
    },
    inspectResources: unused,
    execute: unused,
    startContainerExecution: unused,
    inspectTelemetry: () => Promise.resolve({ kind: 'disabled' }),
    stop: unused,
  };
}

export async function driverProject(source: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'capsule-driver-'));
  roots.push(directory);
  await writeFile(join(directory, 'driver.mjs'), source);
  return directory;
}

export function driverInput(
  projectDirectory: string,
  selected: ResolvedCatalogDriver = httpDriver,
) {
  return {
    projectDirectory,
    sessionId: 'quiet-river-ada',
    activityId: 'activity-1',
    entrypoint: { url: 'http://localhost:4321', host: 'localhost', port: 4321, protocol: 'http' },
    driver: { ...selected, ref: 'driver.mjs' },
    argv: [process.execPath, '-e', 'process.stdout.write(process.env.DRIVER_VALUE)'] as const,
    untraced: { kind: 'refuse' as const },
    sandbox: driverSandbox(),
    scope: createTelemetryExecutionScope({ executionId: 'activity-1', operationName: 'test' }),
    interaction: {
      kind: 'captured' as const,
      cancellation: { kind: 'not-cancellable' as const },
      controls: noControls(),
    },
  };
}

export async function cleanDriverProjects(): Promise<void> {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
}
