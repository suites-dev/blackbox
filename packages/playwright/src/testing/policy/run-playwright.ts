import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { JSONReport } from '@playwright/test/reporter';

/** Kill a runner that hangs; leave room for a loaded CI machine. */
export const runTimeoutMs = 60_000;

export const policyFixture = import.meta.dirname;

export interface Run {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly directory: string;
}

/** The config variant (default `baseline`) and the baseline path (default the fixture's). */
export type RunOptions = Readonly<Partial<{ variant: string; baseline: string }>>;

const directories: string[] = [];

/** Remove every output directory created by runPolicyFixture. */
export async function removeRunDirectories(): Promise<void> {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
}

export async function jsonReport(run: Run): Promise<JSONReport> {
  return JSON.parse(await readFile(join(run.directory, 'results.json'), 'utf8')) as JSONReport;
}

/** Run the policy fixture through the native Playwright CLI in a fresh output directory. */
export async function runPolicyFixture(
  args: readonly string[],
  options: RunOptions = { variant: 'baseline' },
): Promise<Run> {
  const directory = await mkdtemp(join(tmpdir(), 'blackbox-runner-policy-'));
  directories.push(directory);
  const require = createRequire(import.meta.url);
  const child = spawn(
    process.execPath,
    [
      require.resolve('@playwright/test/cli'),
      'test',
      '--config',
      join(policyFixture, 'playwright.config.ts'),
      ...args,
    ],
    {
      cwd: directory,
      env: {
        ...process.env,
        BLACKBOX_PLAYWRIGHT_OUTPUT_DIR: directory,
        BLACKBOX_TEST_POLICY_VARIANT: options.variant ?? 'baseline',
        BLACKBOX_TEST_POLICY_BASELINE: options.baseline,
        FORCE_COLOR: '0',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString('utf8')));
  child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString('utf8')));
  const timer = setTimeout(() => child.kill('SIGKILL'), runTimeoutMs);
  try {
    const code = await new Promise<number>((resolve, reject) => {
      child.once('error', reject);
      child.once('close', (exitCode) => {
        resolve(exitCode ?? 1);
      });
    });
    return { code, stdout, stderr, directory };
  } finally {
    clearTimeout(timer);
  }
}
