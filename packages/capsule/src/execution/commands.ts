import { spawn } from 'node:child_process';

import type { SandboxHandle } from '@suites/blackbox-sandbox-internal';

import type { CapsuleEntrypoint, CapsuleProcessOutcome } from '../types.js';

function assertNever(value: never): never {
  throw new Error(`Unhandled execution result: ${JSON.stringify(value)}`);
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

export async function awaitReadiness(input: {
  readonly entrypoint: CapsuleEntrypoint;
  readonly path: string;
  readonly timeoutMs: number;
}): Promise<void> {
  const deadline = Date.now() + input.timeoutMs;
  const url = new URL(input.path, `${input.entrypoint.url}/`);
  let lastError = new Error('Readiness endpoint was not attempted');
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2_000) });
      if (response.ok) {
        return;
      }
      lastError = new Error(`Readiness returned HTTP ${response.status}`);
    } catch (error) {
      lastError = asError(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Readiness did not succeed within ${input.timeoutMs}ms`, { cause: lastError });
}

export function runHost(input: {
  readonly argv: readonly [string, ...string[]];
  readonly cwd: string;
  readonly environment: Readonly<Record<string, string>>;
}): Promise<CapsuleProcessOutcome> {
  return new Promise((resolve, reject) => {
    const [command, ...arguments_] = input.argv;
    const child = spawn(command, arguments_, {
      cwd: input.cwd,
      env: { ...process.env, ...input.environment },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
    child.once('error', reject);
    child.once('close', (exitCode, signal) => {
      const shared = {
        argv: [...input.argv],
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
      };
      resolve(
        signal === null
          ? { kind: 'exited', ...shared, exitCode: exitCode ?? 1 }
          : { kind: 'signaled', ...shared, signal },
      );
    });
  });
}

export async function runParticipant(input: {
  readonly sandbox: SandboxHandle;
  readonly service: string;
  readonly argv: readonly [string, ...string[]];
}): Promise<CapsuleProcessOutcome> {
  const result = await input.sandbox.execute({
    kind: 'container-exec',
    service: input.service,
    argv: input.argv,
  });
  switch (result.kind) {
    case 'exited':
      return {
        kind: 'exited',
        argv: [...input.argv],
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
      };
    case 'execution-failed':
      throw new Error(`Sandbox participant execution failed: ${JSON.stringify(result.failure)}`);
    default:
      return assertNever(result);
  }
}
