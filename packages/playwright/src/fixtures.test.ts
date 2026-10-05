import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

import { afterEach, expect, it } from 'vitest';

const directories: string[] = [];
type ObserverEvent = Readonly<Record<string, unknown>>;

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

async function runPlaywright(input: {
  readonly configFile: string;
  readonly outputDirectory: string;
}): Promise<{ readonly exitCode: number; readonly output: string }> {
  const require = createRequire(import.meta.url);
  const cli = require.resolve('@playwright/test/cli');
  const config = join(import.meta.dirname, 'testing', input.configFile);
  await mkdir(input.outputDirectory, { recursive: true });
  const child = spawn(process.execPath, [cli, 'test', '--config', config], {
    cwd: input.outputDirectory,
    env: {
      ...process.env,
      // Playwright clears this child directory; the observer's cwd must survive.
      BLACKBOX_PLAYWRIGHT_OUTPUT_DIR: join(input.outputDirectory, 'attempts'),
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

async function observerEvents(directory: string): Promise<ObserverEvent[]> {
  const text = await readFile(join(directory, 'native-step-events.jsonl'), 'utf8');
  return text
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as ObserverEvent);
}

function stepPair(
  events: readonly ObserverEvent[],
  testTitle: string,
  stepTitle: string,
  error: RegExp | null,
): { readonly begin: ObserverEvent; readonly end: ObserverEvent } {
  const pair = events.filter((event) => event.testTitle === testTitle && event.title === stepTitle);
  expect(pair.map((event) => event.phase)).toEqual(['begin', 'end']);
  const [begin, end] = pair;
  if (error === null) {
    expect(end.error).toBeNull();
  } else {
    expect(end.error).toEqual(expect.stringMatching(error));
  }
  return { begin, end };
}

function expectStepParent(event: ObserverEvent, title: string, category: string): void {
  expect(event.parentTitle).toBe(title);
  expect(event.parentCategory).toBe(category);
}

function resultSnapshot(events: readonly ObserverEvent[], testTitle: string): ObserverEvent {
  const results = events.filter(
    (event) => event.phase === 'result' && event.testTitle === testTitle,
  );
  expect(results).toHaveLength(1);
  return results[0];
}

it('owns one sandbox lifecycle per Playwright physical attempt, including a retry', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'blackbox-playwright-fixture-'));
  directories.push(directory);
  const result = await runPlaywright({
    configFile: 'playwright.config.ts',
    outputDirectory: join(directory, 'output'),
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

it('lets the Playwright test timeout govern sandbox acquisition', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'blackbox-playwright-timeout-'));
  directories.push(directory);
  const result = await runPlaywright({
    configFile: 'fixture-timeout.config.ts',
    outputDirectory: join(directory, 'output'),
  });
  expect(result.exitCode, result.output).toBe(1);
  expect(result.output).toContain('4 failed');
  expect(result.output).toContain(
    'Blackbox sandbox acquisition exceeded the Playwright test timeout of 20ms',
  );
  expect(result.output).toContain('BLACKBOX_PLAYWRIGHT_TIMEOUT_STOP orders failed');
  expect(result.output).toContain(
    'Blackbox sandbox acquisition cleanup did not settle within 30ms',
  );
  expect(result.output).toContain(
    'Blackbox sandbox cleanup did not settle within 30ms after completed',
  );
  expect(result.output).toContain('BLACKBOX_PLAYWRIGHT_SLOW_STOP_INVOKED');
  expect(result.output).toContain('BLACKBOX_PLAYWRIGHT_BODY_ENTERED');
  expect(result.output).toContain('BLACKBOX_PLAYWRIGHT_BODY_TIMEOUT_STOP failed');
  expect(result.output).not.toContain('BLACKBOX_PLAYWRIGHT_ACQUISITION_BODY_ENTERED');
  expect(result.output).not.toContain('BLACKBOX_PLAYWRIGHT_LATE_BODY_ENTERED');
  expect(result.output).not.toContain('Blackbox: sandbox');

  const events = await observerEvents(join(directory, 'output'));
  const acquisitionTitle = 'times out before a slow acquisition reaches the test body';
  const acquisitionStart = stepPair(
    events,
    acquisitionTitle,
    'Start sandbox',
    /acquisition exceeded/u,
  );
  const acquisitionCleanup = stepPair(events, acquisitionTitle, 'Clean up sandbox', null);
  expectStepParent(acquisitionStart.begin, 'Fixture "Blackbox sandbox"', 'fixture');
  expectStepParent(acquisitionCleanup.begin, 'Start sandbox', 'test.step');
  expect(Number(acquisitionStart.begin.observedAt)).toBeLessThanOrEqual(
    Number(acquisitionCleanup.begin.observedAt),
  );
  expect(Number(acquisitionCleanup.end.observedAt)).toBeLessThanOrEqual(
    Number(acquisitionStart.end.observedAt),
  );

  const lateTitle = 'reports when late acquisition cleanup does not settle';
  const lateStart = stepPair(events, lateTitle, 'Start sandbox', /did not settle within 30ms/u);
  const lateCleanup = stepPair(
    events,
    lateTitle,
    'Clean up sandbox',
    /did not settle within 30ms/u,
  );
  expectStepParent(lateStart.begin, 'Fixture "Blackbox sandbox"', 'fixture');
  expectStepParent(lateCleanup.begin, 'Start sandbox', 'test.step');
  expect(Number(lateCleanup.end.observedAt)).toBeLessThanOrEqual(Number(lateStart.end.observedAt));
  expect(Number(lateCleanup.end.duration)).toBeLessThan(400);

  const stopTitle = 'reports when sandbox teardown does not settle';
  const stopStart = stepPair(events, stopTitle, 'Start sandbox', null);
  const stopCleanup = stepPair(
    events,
    stopTitle,
    'Clean up sandbox',
    /did not settle within 30ms/u,
  );
  expectStepParent(stopStart.begin, 'Fixture "Blackbox sandbox"', 'fixture');
  expectStepParent(stopCleanup.begin, 'Fixture "Blackbox sandbox"', 'fixture');

  const bodyTitle = 'completes its native cleanup step after the body times out';
  const bodyStart = stepPair(events, bodyTitle, 'Start sandbox', null);
  const bodyCleanup = stepPair(events, bodyTitle, 'Clean up sandbox', null);
  expectStepParent(bodyStart.begin, 'Fixture "Blackbox sandbox"', 'fixture');
  expectStepParent(bodyCleanup.begin, 'Fixture "Blackbox sandbox"', 'fixture');
  expect(Number(bodyStart.end.observedAt)).toBeLessThanOrEqual(
    Number(bodyCleanup.begin.observedAt),
  );
  expect(resultSnapshot(events, bodyTitle).status).toBe('timedOut');
});
