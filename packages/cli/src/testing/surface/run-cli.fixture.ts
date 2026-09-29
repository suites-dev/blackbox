import { spawn } from 'node:child_process';

import { cliExecutable } from '../cli-path.fixture.js';

export interface CliResult {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * Runs the built CLI with a controlled environment: BLACKBOX_CAPSULE is set
 * only when given, so ambient shell state never selects a capsule.
 */
export function cli(input: {
  readonly directory: string;
  readonly argv: readonly string[];
  readonly capsuleEnvironment: string | null;
}): Promise<CliResult> {
  const env = { ...process.env };
  delete env.BLACKBOX_CAPSULE;
  if (input.capsuleEnvironment !== null) {
    env.BLACKBOX_CAPSULE = input.capsuleEnvironment;
  }
  const child = spawn(process.execPath, [cliExecutable(), ...input.argv], {
    cwd: input.directory,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
    stderr += chunk;
  });
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (status) => {
      resolve({ status, stdout, stderr });
    });
  });
}

export function run(directory: string, ...argv: string[]): Promise<CliResult> {
  return cli({ directory, argv, capsuleEnvironment: null });
}

/** Asserts stdout is exactly one JSON document (one line) and returns it. */
export function onlyDocument(result: CliResult): Record<string, unknown> {
  const lines = result.stdout.split('\n');
  if (lines.length !== 2 || lines[1] !== '') {
    throw new Error(
      `expected exactly one JSON line on stdout, got: ${JSON.stringify(result.stdout)}`,
    );
  }
  const document: unknown = JSON.parse(lines[0]);
  if (typeof document !== 'object' || document === null || Array.isArray(document)) {
    throw new Error(`expected a JSON object on stdout, got: ${lines[0]}`);
  }
  return document as Record<string, unknown>;
}

export function processOutcome(input: {
  readonly kind: 'exited' | 'signaled';
  readonly exitCode: number;
  readonly signal: string;
}) {
  const base = {
    argv: ['sh'],
    location: { kind: 'host' },
    stdout: 'child-out\n',
    stderr: 'child-err\n',
    retention: {
      stdout: { kind: 'complete', originalBytes: 10 },
      stderr: { kind: 'complete', originalBytes: 10 },
    },
  };
  return input.kind === 'exited'
    ? { kind: 'exited', exitCode: input.exitCode, ...base }
    : { kind: 'signaled', signal: input.signal, ...base };
}
