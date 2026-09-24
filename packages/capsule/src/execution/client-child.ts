import { spawn } from 'node:child_process';

import type { ClientInspectionResult, ClientProcessResult } from '@suites/blackbox-client';

export interface ClientChildResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

export function runClientChild(input: {
  readonly argv: readonly [string, ...string[]];
  readonly cwd: string;
  readonly environment: Readonly<Record<string, string>>;
  readonly stdin: string;
}): Promise<ClientChildResult> {
  return new Promise((complete, reject) => {
    const [command, ...arguments_] = input.argv;
    const child = spawn(command, arguments_, {
      cwd: input.cwd,
      env: { ...process.env, ...input.environment },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
    child.once('error', reject);
    child.once('close', (code, signal) => {
      if (signal !== null) {
        reject(new Error(`Client process terminated by ${signal}`));
        return;
      }
      complete({
        exitCode: code ?? 1,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
      });
    });
    child.stdin.end(input.stdin);
  });
}

export function parseClientJson(input: ClientChildResult, operation: string): unknown {
  if (input.exitCode !== 0) {
    throw new Error(`${operation} exited with ${String(input.exitCode)}: ${input.stderr}`);
  }
  try {
    return JSON.parse(input.stdout) as unknown;
  } catch (error) {
    throw new Error(`${operation} returned invalid JSON: ${input.stderr}`, { cause: error });
  }
}

export function clientInspectionResult(value: unknown): ClientInspectionResult {
  if (typeof value !== 'object' || value === null || !('kind' in value)) {
    throw new Error('Client inspection returned an invalid result');
  }
  if (
    (value.kind === 'available' && 'client' in value) ||
    (value.kind === 'unavailable' && 'error' in value)
  ) {
    return value as ClientInspectionResult;
  }
  throw new Error('Client inspection returned an invalid result');
}

export function clientProcessResult(value: unknown): ClientProcessResult {
  if (
    typeof value === 'object' &&
    value !== null &&
    'kind' in value &&
    (value.kind === 'completed' || value.kind === 'failed')
  ) {
    return value as ClientProcessResult;
  }
  throw new Error('Client execution returned an invalid result');
}
