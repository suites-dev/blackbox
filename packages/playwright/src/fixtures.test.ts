import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

import { afterEach, expect, it } from 'vitest';

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

async function runPlaywright(input: {
  readonly eventLog: string;
  readonly outputDirectory: string;
}): Promise<{ readonly exitCode: number; readonly output: string }> {
  const require = createRequire(import.meta.url);
  const cli = require.resolve('@playwright/test/cli');
  const config = join(import.meta.dirname, 'testing', 'playwright.config.ts');
  const child = spawn(process.execPath, [cli, 'test', '--config', config], {
    cwd: join(import.meta.dirname, '..'),
    env: {
      ...process.env,
      BLACKBOX_PLAYWRIGHT_EVENT_LOG: input.eventLog,
      BLACKBOX_PLAYWRIGHT_OUTPUT_DIR: input.outputDirectory,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (chunk: Buffer) => {
    output += chunk.toString('utf8');
  });
  child.stderr.on('data', (chunk: Buffer) => {
    output += chunk.toString('utf8');
  });
  const exitCode = await new Promise<number>((resolveExit, reject) => {
    child.once('error', (error) => {
      reject(error);
    });
    child.once('exit', (code) => {
      resolveExit(code ?? 1);
    });
  });
  return { exitCode, output };
}

it('owns one sandbox lifecycle per Playwright physical attempt, including a retry', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'blackbox-playwright-fixture-'));
  directories.push(directory);
  const eventLog = join(directory, 'events.jsonl');
  const result = await runPlaywright({ eventLog, outputDirectory: join(directory, 'output') });
  expect(result.exitCode, result.output).toBe(0);
  const events = (await readFile(eventLog, 'utf8'))
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as Record<string, unknown>);
  const starts = events.filter((event) => event.kind === 'start');
  const stops = events.filter((event) => event.kind === 'stop');
  expect(starts).toHaveLength(4);
  expect(stops).toHaveLength(4);
  expect(new Set(starts.map((event) => event.executionId)).size).toBe(4);
  expect(new Set(starts.map((event) => event.artifactDirectory)).size).toBe(4);
  expect(stops.map((event) => event.reason)).toEqual([
    'completed',
    'completed',
    'failed',
    'completed',
  ]);
});
