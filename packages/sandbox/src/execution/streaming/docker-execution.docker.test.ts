import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { startSandbox } from '../../sandbox.js';
import type { SandboxContainerOutputEvent, SandboxContainerExecutionStartResult } from './types.js';
import type { SandboxHandle } from '../../types.js';

const fixtureDirectory = join(dirname(fileURLToPath(import.meta.url)), '../../../test-fixtures');
let active: SandboxHandle | null = null;
const recordDirectories: string[] = [];

afterEach(async () => {
  if (active !== null) {
    await active.stop({ reason: 'completed' });
    active = null;
  }
  await Promise.all(
    recordDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe.skipIf(process.env.BLACKBOX_SANDBOX_DOCKER_TEST !== '1')(
  'streaming container execution',
  () => {
    it('streams psql-like stdin and preserves literal command content', async () => {
      active = await acquireSandbox();
      const output: SandboxContainerOutputEvent[] = [];
      const started = await active.startContainerExecution({
        kind: 'container-stream-exec',
        service: 'echo',
        argv: ['/bin/cat'],
        environment: { PGDATABASE: 'subscriptions' },
        terminal: { kind: 'captured' },
        onOutput: (event) => output.push(event),
      });
      const execution = requireStarted(started);
      const sql = "select '$HOME; still literal';\n";
      await execution.writeStdin({ kind: 'stdin-chunk', chunk: Buffer.from(sql) });
      await execution.endStdin();
      await expect(execution.completion).resolves.toEqual({
        kind: 'exited',
        service: 'echo',
        exitCode: 0,
      });
      expect(textFor(output, 'stdout')).toBe(sql);
      expect(textFor(output, 'stderr')).toBe('');
    }, 90_000);

    it('reports a missing executable without stopping the participant', async () => {
      active = await acquireSandbox();
      const result = await active.startContainerExecution({
        kind: 'container-stream-exec',
        service: 'echo',
        argv: ['blackbox-missing-psql'],
        environment: {},
        terminal: { kind: 'captured' },
        onOutput: () => undefined,
      });
      const execution = requireStarted(result);
      await expect(execution.completion).resolves.toMatchObject({
        kind: 'execution-failed',
        failure: {
          kind: 'executable-not-found',
          service: 'echo',
          executable: 'blackbox-missing-psql',
        },
      });
      await expect(fetch(`http://${endpoint(active)}`)).resolves.toMatchObject({ ok: true });
    }, 90_000);
  },
);

async function acquireSandbox(): Promise<SandboxHandle> {
  const sandboxId = `stream-exec-${randomUUID()}`;
  const recordDirectory = join(fixtureDirectory, '.records', sandboxId);
  recordDirectories.push(recordDirectory);
  return startSandbox({
    sandbox: {
      sandboxId,
      projectDirectory: fixtureDirectory,
      composeFiles: ['concurrency.compose.yaml'],
      recordDirectory,
      environment: { SANDBOX_ID: sandboxId },
      serviceSelection: { kind: 'selected', services: ['echo'] },
      endpoints: [{ name: 'http', service: 'echo', containerPort: 80 }],
      startupTimeoutMs: 60_000,
      stopTimeoutMs: 20_000,
      telemetry: { kind: 'disabled' },
    },
    progress: { kind: 'silent' },
  });
}

function requireStarted(result: SandboxContainerExecutionStartResult) {
  if (result.kind === 'execution-failed') {
    throw new Error(`Container execution did not start: ${result.failure.kind}`);
  }
  return result.execution;
}

function textFor(
  events: readonly SandboxContainerOutputEvent[],
  kind: 'stdout' | 'stderr',
): string {
  const chunks = events.filter((event) => event.kind === kind).map((event) => event.chunk);
  return Buffer.concat(chunks).toString();
}

function endpoint(handle: SandboxHandle): string {
  const value = handle.endpoints.get('http');
  if (value === undefined) {
    throw new Error('Expected HTTP endpoint');
  }
  return `${value.host}:${value.port}`;
}
