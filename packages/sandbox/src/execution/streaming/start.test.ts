import { expect, it } from 'vitest';
import { startContainerExecution } from './start.js';
import type { SandboxContainer, SandboxContainerExecutionInput } from '../../index.js';

const container = {
  service: 'postgres',
  testcontainer: {
    id: 'postgres-id',
    name: 'postgres-1',
    host: '127.0.0.1',
    labels: {},
    environment: {},
    networkNames: ['sandbox_default'],
    mappedPorts: new Map(),
    getMappedPort: () => 5432,
  },
} satisfies SandboxContainer;

function request(
  terminal: SandboxContainerExecutionInput['terminal'],
): SandboxContainerExecutionInput {
  return {
    kind: 'container-stream-exec',
    service: 'postgres',
    argv: ['psql', '--no-psqlrc'],
    environment: {},
    terminal,
    onOutput: () => undefined,
  };
}

function malformedRequest(value: unknown): SandboxContainerExecutionInput {
  return value as SandboxContainerExecutionInput;
}

it('rejects unknown services and stopped sandboxes without Docker access', async () => {
  await expect(
    startContainerExecution({
      request: { ...request({ kind: 'captured' }), service: 'missing' },
      state: 'running',
      containers: new Map([['postgres', container]]),
    }),
  ).resolves.toEqual({
    kind: 'execution-failed',
    failure: { kind: 'unknown-service', service: 'missing' },
  });
  await expect(
    startContainerExecution({
      request: request({ kind: 'captured' }),
      state: 'completed',
      containers: new Map([['postgres', container]]),
    }),
  ).resolves.toEqual({
    kind: 'execution-failed',
    failure: { kind: 'sandbox-not-running', state: 'completed' },
  });
});

it('rejects invalid initial tty dimensions before Docker access', async () => {
  await expect(
    startContainerExecution({
      request: request({ kind: 'tty', columns: 0, rows: 24 }),
      state: 'running',
      containers: new Map([['postgres', container]]),
    }),
  ).resolves.toEqual({
    kind: 'execution-failed',
    failure: { kind: 'invalid-terminal-size', columns: 0, rows: 24 },
  });
});

it('rejects an empty argv before Docker access', async () => {
  await expect(
    startContainerExecution({
      request: malformedRequest({ ...request({ kind: 'captured' }), argv: [] }),
      state: 'running',
      containers: new Map([['postgres', container]]),
    }),
  ).resolves.toEqual({
    kind: 'execution-failed',
    failure: { kind: 'invalid-argv', reason: 'empty' },
  });
});
