import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
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
  readonly configFile: string;
  readonly outputDirectory: string;
  readonly environment: Readonly<Record<string, string>>;
}): Promise<{ readonly exitCode: number; readonly output: string }> {
  const require = createRequire(import.meta.url);
  const cli = require.resolve('@playwright/test/cli');
  const config = join(import.meta.dirname, 'testing', input.configFile);
  const child = spawn(process.execPath, [cli, 'test', '--config', config], {
    cwd: join(import.meta.dirname, '..'),
    env: {
      ...process.env,
      ...input.environment,
      BLACKBOX_PLAYWRIGHT_OUTPUT_DIR: input.outputDirectory,
      FORCE_COLOR: '0',
      NO_COLOR: undefined,
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
  const result = await runPlaywright({
    configFile: 'playwright.config.ts',
    outputDirectory: join(directory, 'output'),
    environment: {},
  });
  expect(result.exitCode, result.output).toBe(0);
  const marker = 'BLACKBOX_PLAYWRIGHT_EVENT ';
  const events = result.output
    .split('\n')
    .filter((line) => line.startsWith(marker))
    .map((line) => JSON.parse(line.slice(marker.length)) as Record<string, unknown>);
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

function playwrightEvents(output: string): Record<string, unknown>[] {
  const marker = 'BLACKBOX_PLAYWRIGHT_EVENT ';
  return output
    .split('\n')
    .filter((line) => line.startsWith(marker))
    .map((line) => JSON.parse(line.slice(marker.length)) as Record<string, unknown>);
}

it('stops the sandbox when acquisition takes more than half the test timeout', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'blackbox-playwright-slow-'));
  directories.push(directory);
  const result = await runPlaywright({
    configFile: 'slow-acquisition.config.ts',
    outputDirectory: join(directory, 'output'),
    environment: {},
  });
  expect(result.exitCode, result.output).toBe(0);
  expect(result.output).not.toContain('exceeded during setup');
  expect(playwrightEvents(result.output)).toEqual([
    { kind: 'start' },
    { kind: 'body', sandboxId: 'slow-sandbox' },
    { kind: 'stop', reason: 'completed' },
  ]);
});

it('reports acquisition and cleanup as steps with their own durations', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'blackbox-playwright-steps-'));
  directories.push(directory);
  const result = await runPlaywright({
    configFile: 'slow-acquisition.config.ts',
    outputDirectory: join(directory, 'output'),
    environment: {},
  });
  expect(result.exitCode, result.output).toBe(0);
  const acquisition =
    /Before Hooks › Fixture "_blackboxAttempt" › Blackbox: acquire sandbox \((\d+)ms\)/u.exec(
      result.output,
    );
  expect(acquisition, result.output).not.toBeNull();
  // The runtime takes 300ms to acquire; the step duration must include that time.
  expect(Number(acquisition![1])).toBeGreaterThanOrEqual(300);
  expect(result.output).toMatch(
    /After Hooks › Fixture "_blackboxAttempt" › Blackbox: clean up sandbox \(\d+ms\)/u,
  );
});

it('acquires no sandbox for beforeAll/afterAll hooks and refuses Blackbox fixtures there', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'blackbox-playwright-hooks-'));
  directories.push(directory);
  const result = await runPlaywright({
    configFile: 'suite-hooks.config.ts',
    outputDirectory: join(directory, 'output'),
    environment: {},
  });
  expect(result.exitCode, result.output).toBe(1);
  expect(result.output).toContain('1 passed');
  expect(result.output).toContain(
    'Blackbox fixture "sandbox" is not available in beforeAll hooks: each test attempt owns its own sandbox.',
  );
  expect(playwrightEvents(result.output)).toEqual([
    { kind: 'beforeAll', baseURL: null, request: 'object' },
    { kind: 'start', sandboxId: 'hook-sandbox-1' },
    { kind: 'beforeEach', sandboxId: 'hook-sandbox-1' },
    { kind: 'body', sandboxId: 'hook-sandbox-1', baseURL: 'http://127.0.0.1:1' },
    { kind: 'stop', sandboxId: 'hook-sandbox-1', reason: 'completed' },
    { kind: 'afterAll', baseURL: null },
  ]);
});

it('propagates the attempt trace through request, but not from suite hooks', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'blackbox-playwright-trace-'));
  directories.push(directory);
  const result = await runPlaywright({
    configFile: 'trace-context.config.ts',
    outputDirectory: join(directory, 'output'),
    environment: {},
  });
  expect(result.exitCode, result.output).toBe(0);
  expect(result.output).toContain('1 passed');
});

it('lets the Playwright test timeout govern sandbox acquisition', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'blackbox-playwright-timeout-'));
  directories.push(directory);
  const result = await runPlaywright({
    configFile: 'fixture-timeout.config.ts',
    outputDirectory: join(directory, 'output'),
    environment: {},
  });
  expect(result.exitCode, result.output).toBe(1);
  expect(result.output).toContain('3 failed');
  expect(result.output).toContain(
    'Blackbox sandbox acquisition exceeded the Playwright test timeout of 20ms',
  );
  expect(result.output).toContain('BLACKBOX_PLAYWRIGHT_TIMEOUT_STOP failed');
  expect(result.output).toContain(
    'Blackbox sandbox acquisition cleanup did not settle within 30ms',
  );
  expect(result.output).toContain(
    'Blackbox sandbox cleanup did not settle within 30ms after completed',
  );
});

it('retains each attempt beyond the next run only when asked to', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'blackbox-playwright-retention-'));
  directories.push(directory);
  const run = async (retain: 'on' | 'off') => {
    // Playwright clears its output directory on every run, as in a real project.
    const result = await runPlaywright({
      configFile: 'retention.config.ts',
      outputDirectory: join(directory, 'output'),
      environment: { BLACKBOX_TEST_PROJECT: directory, BLACKBOX_TEST_RETAIN: retain },
    });
    expect(result.exitCode, result.output).toBe(0);
    const [start] = playwrightEvents(result.output);
    return String(start.sandboxId);
  };
  const experiments = join(directory, '.blackbox', 'experiments');

  await run('off');
  await expect(readdir(directory)).resolves.not.toContain('.blackbox');

  const first = await run('on');
  const second = await run('on');
  expect((await readdir(experiments)).sort()).toEqual([first, second].sort());
  await expect(
    readFile(join(experiments, first, 'sandbox', `${first}.json`), 'utf8'),
  ).resolves.toBe(JSON.stringify({ sandboxId: first }));
  const document = JSON.parse(await readFile(join(experiments, first, 'attempt.json'), 'utf8')) as {
    identity: { sandboxId: string };
    events: { phase: string; status: string }[];
  };
  expect(document.identity.sandboxId).toBe(first);
  expect(document.events).toContainEqual(
    expect.objectContaining({ phase: 'teardown', status: 'completed' }),
  );
  // Three Playwright runs: leave room for a loaded machine running every package's tests.
}, 120_000);
