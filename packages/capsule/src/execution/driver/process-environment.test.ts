import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ResolvedCatalogDriver } from '@suites/blackbox-catalog-internal';
import type { SandboxHandle } from '@suites/blackbox-sandbox-internal';
import { createTelemetryExecutionScope } from '@suites/blackbox-telemetry-internal';
import { afterEach, expect, it } from 'vitest';

import { runCapsuleDriver } from '../driver-execution.js';

const roots: string[] = [];
const driver = {
  id: 'http', kind: 'project-driver', runtime: 'node', ref: 'driver.mjs',
  target: { kind: 'participant', participantId: 'api', service: 'api',
    protocol: 'http', containerPort: 3000 },
  execution: { kind: 'host' },
  propagation: { kind: 'w3c-trace-context-propagation', carrier: 'process-environment' },
} satisfies ResolvedCatalogDriver;

function sandbox(): SandboxHandle {
  const unused = () => { throw new Error('unused'); };
  const testcontainer = { id: 'api', name: 'api-1', host: '127.0.0.1', labels: {},
    environment: {}, networkNames: [], mappedPorts: new Map<number, number>(),
    getMappedPort: () => 4321 };
  const container = { service: 'api', testcontainer };
  return {
    sandboxId: 'sandbox', projectName: 'project', state: 'running', declaredEnvironment: {},
    endpoints: new Map([['driver-http', { name: 'driver-http', service: 'api',
      containerPort: 3000, host: '127.0.0.1', port: 4321 }]]),
    containers: new Map([['api', container]]), telemetry: { kind: 'disabled' },
    getContainer: () => container, inspectResources: unused,
    execute: unused, startContainerExecution: unused,
    inspectTelemetry: () => Promise.resolve({ kind: 'disabled' }), stop: unused,
  };
}

async function execute(environment: string) {
  const projectDirectory = await mkdtemp(join(tmpdir(), 'capsule-process-env-'));
  roots.push(projectDirectory);
  await writeFile(join(projectDirectory, 'driver.mjs'), `export default {
    kind: 'project-driver', name: 'http', prepare(request) {
      return { kind: 'prepared-command', argv: request.command.argv,
        environment: { TRACEPARENT: ${environment} },
        propagation: { kind: 'context-injected', format: 'w3c-trace-context',
          carrier: 'process-environment' },
        redaction: { kind: 'driver-redaction', requestArgv: { kind: 'none' },
          preparedArgv: { kind: 'none' }, environment: { kind: 'none' } } };
    }
  };`);
  const scope = createTelemetryExecutionScope({ executionId: 'activity-1', operationName: 'test' });
  const result = await runCapsuleDriver({
    projectDirectory, sessionId: 'quiet-river-ada', activityId: 'activity-1', driver,
    entrypoint: { url: 'http://localhost:4321', host: 'localhost', port: 4321, protocol: 'http' },
    argv: [process.execPath, '-e', 'process.stdout.write(process.env.TRACEPARENT)'],
    untraced: { kind: 'refuse' }, sandbox: sandbox(), scope,
    interaction: { kind: 'captured' },
  });
  return { result, traceparent: scope.active.context.traceparent };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

it('injects the actual execution scope through process environment', async () => {
  const { result, traceparent } = await execute('request.telemetry.traceparent');
  expect(result).toMatchObject({ kind: 'driver-completed', process: { stdout: traceparent } });
});

it('refuses a contradictory process environment', async () => {
  const { result } = await execute("'contradictory'");
  expect(result).toMatchObject({
    kind: 'driver-propagation-refused',
    propagation: { outcome: { kind: 'context-injection-failed',
      message: expect.stringContaining('contradicts canonical TRACEPARENT') } },
  });
});
