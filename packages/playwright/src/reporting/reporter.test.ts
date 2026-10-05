import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stripVTControlCharacters } from 'node:util';

import { expect, it } from 'vitest';

import type { JSONReport } from '@playwright/test/reporter';

type JSONResult = JSONReport['suites'][number]['specs'][number]['tests'][number]['results'][number];
type OwnedResult = JSONResult & { readonly testId: string; readonly title: string };
type ObserverEvent = Readonly<Record<string, unknown>>;

function expectNativeOutput(
  result: { code: number; output: string },
  options: { color: string; native: string },
): void {
  const output = stripVTControlCharacters(result.output);
  expect(result.code, result.output).toBe(1);
  expect(output).toContain('Running 4 tests using 2 workers');
  expect(output).toContain('2 failed');
  expect(output).toContain('1 flaky');
  expect(output).toContain('1 passed');
  expect(output.match(/native-test-output/gu)).toHaveLength(1);
  expect(output.match(/native-test-error-output/gu)).toHaveLength(1);
  expect(result.output.includes('\u001b')).toBe(options.color === '1');
  expect(output).not.toContain('Blackbox: sandbox');
  expect(output).not.toContain('Blackbox ·');
  expect(output).not.toMatch(/^\[\d+\]\s+[·✓→]/mu);
  expect(output).not.toContain('synthetic-secret');
  expect(output).not.toContain('Reporter did not publish progress');
  expect(output).not.toContain('Config was not resolved');
  if (options.native === 'list') {
    expect(output).toContain('Start sandbox');
    expect(output).toContain('Clean up sandbox');
    expect(output).toContain('Given an eligible customer');
    expect(output).toContain('When a subscription is requested');
  }
}

function resultNamed(results: readonly OwnedResult[], title: string, retry: number): OwnedResult {
  const result = results.find(
    (candidate) => candidate.title === title && candidate.retry === retry,
  );
  if (result === undefined) {
    throw new Error(`Missing result ${JSON.stringify(title)} retry ${retry}`);
  }
  return result;
}

function expectStepPair(
  events: readonly ObserverEvent[],
  result: OwnedResult,
  title: string,
  error: RegExp | null,
): { readonly begin: ObserverEvent; readonly end: ObserverEvent } {
  const pair = events.filter(
    (event) =>
      event.testId === result.testId && event.retry === result.retry && event.title === title,
  );
  expect(pair.map((event) => event.phase)).toEqual(['begin', 'end']);
  const [begin, end] = pair;
  expect(begin.observedAt).toEqual(expect.any(Number));
  expect(begin.startTime).toEqual(expect.any(Number));
  expect(begin.parentCategory).toBe('fixture');
  expect(begin.parentTitle).toBe('Fixture "Blackbox sandbox"');
  expect(end.duration).toEqual(expect.any(Number));
  expect(Number(end.observedAt)).toBeGreaterThanOrEqual(Number(begin.observedAt));
  if (error === null) {
    expect(end.error).toBeNull();
  } else {
    expect(end.error).toEqual(expect.stringMatching(error));
  }
  return { begin, end };
}

function expectResultSnapshot(
  events: readonly ObserverEvent[],
  result: OwnedResult,
  titles: readonly string[],
): void {
  const snapshots = events.filter(
    (event) =>
      event.phase === 'result' && event.testId === result.testId && event.retry === result.retry,
  );
  expect(snapshots).toHaveLength(1);
  const lifecycle = snapshots[0].lifecycle as readonly Readonly<Record<string, unknown>>[];
  expect(lifecycle.map((step) => step.title)).toEqual(titles);
}

async function expectNativeLifecycle(directory: string, results: readonly OwnedResult[]) {
  const lines = (await readFile(join(directory, 'native-step-events.jsonl'), 'utf8'))
    .trim()
    .split('\n');
  const events = lines.map((line) => JSON.parse(line) as ObserverEvent);
  expect(await readFile(join(directory, 'runtime-observed-native-step'), 'utf8')).toBe('observed');
  const business = resultNamed(results, 'business steps', 0);
  const businessStart = expectStepPair(events, business, 'Start sandbox', null);
  const businessCleanup = expectStepPair(events, business, 'Clean up sandbox', null);
  expect(Number(businessStart.end.observedAt)).toBeLessThanOrEqual(
    Number(businessCleanup.begin.observedAt),
  );
  expectResultSnapshot(events, business, ['Start sandbox', 'Clean up sandbox']);

  for (const retry of [0, 1]) {
    const attempt = resultNamed(results, 'retry isolation', retry);
    expectStepPair(events, attempt, 'Start sandbox', null);
    expectStepPair(events, attempt, 'Clean up sandbox', null);
    expectResultSnapshot(events, attempt, ['Start sandbox', 'Clean up sandbox']);
  }
  const startup = resultNamed(results, 'cannot enter the body', 0);
  expectStepPair(events, startup, 'Start sandbox', /synthetic setup failure/u);
  expectResultSnapshot(events, startup, ['Start sandbox']);
  const cleanup = resultNamed(results, 'retains cleanup failure', 0);
  expectStepPair(events, cleanup, 'Start sandbox', null);
  expectStepPair(events, cleanup, 'Clean up sandbox', /synthetic cleanup failure/u);
  expectResultSnapshot(events, cleanup, ['Start sandbox', 'Clean up sandbox']);
}

function expectAttemptAttachments(results: readonly OwnedResult[]): void {
  expect(results.flatMap(({ attachments }) => attachments.map(({ name }) => name))).not.toContain(
    'setup-body-entered',
  );
  const messages = results.flatMap(({ error }) =>
    error === undefined ? [] : [error.message ?? ''],
  );
  expect(messages.some((message) => message.includes('synthetic setup failure'))).toBe(true);
  expect(messages.some((message) => message.includes('BODY_MUST_NOT_EXECUTE'))).toBe(false);
  const transcripts = results.map((attempt) => {
    const diagnostics = attempt.attachments.find(({ name }) => name === 'blackbox-diagnostics');
    expect(diagnostics).toBeDefined();
    expect(Buffer.from(diagnostics!.body!, 'base64').toString('utf8')).toContain(
      'acquisition: started',
    );
    const retained = attempt.attachments.find(({ name }) => name === 'blackbox-attempt');
    expect(retained).toBeDefined();
    const text = Buffer.from(retained!.body!, 'base64').toString('utf8');
    const document = JSON.parse(text) as { owner: Record<string, unknown> };
    expect(document.owner).toMatchObject({
      testId: attempt.testId,
      retry: attempt.retry,
      workerIndex: attempt.workerIndex,
      parallelIndex: attempt.parallelIndex,
    });
    return text;
  });
  expect(transcripts.join('\n')).not.toContain('synthetic-secret');
  expect(transcripts.filter((text) => text.includes('"phase":"sandbox"'))).toHaveLength(4);
  expect(
    transcripts.filter((text) => text.includes('"phase":"teardown","status":"completed"')),
  ).toHaveLength(3);
  expect(
    transcripts.filter((text) => text.includes('"phase":"teardown","status":"failed"')),
  ).toHaveLength(1);
  const identities = transcripts.flatMap((text) => {
    const match = /"detail":"([a-f0-9-]+); http/u.exec(text);
    return match === null ? [] : [match[1]];
  });
  expect(new Set(identities).size).toBe(4);
}

it.each([
  { color: '0', native: 'list' },
  { color: '1', native: 'list' },
  { color: '0', native: 'auto' },
])('preserves native output, steps and isolated attempt evidence (%j)', async (options) => {
  const directory = await mkdtemp(join(tmpdir(), 'blackbox-reporter-'));
  try {
    const result = await run(directory, options);
    expectNativeOutput(result, options);
    await expect(access(join(directory, 'untrusted-observer'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    const report = JSON.parse(
      await readFile(join(directory, 'results.json'), 'utf8'),
    ) as JSONReport;
    const allResults = resultsIn(report.suites);
    expect(allResults).toHaveLength(5);
    expect(allResults.flatMap(({ stdout }) => stdout.map(stdioText)).join('')).not.toContain(
      'containers acquired',
    );
    const business = resultNamed(allResults, 'business steps', 0);
    expect(business.stdout.map(stdioText).join('')).toContain('native-test-output');
    await expectNativeLifecycle(directory, allResults);
    expectAttemptAttachments(allResults);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

function stdioText(chunk: { text: string } | { buffer: string }): string {
  return 'text' in chunk ? chunk.text : Buffer.from(chunk.buffer, 'base64').toString('utf8');
}

function resultsIn(suites: JSONReport['suites']): OwnedResult[] {
  return suites.flatMap((suite) => [
    ...suite.specs.flatMap((spec) =>
      spec.tests.flatMap((test) =>
        test.results.map((result) => ({ ...result, testId: spec.id, title: spec.title })),
      ),
    ),
    ...resultsIn(suite.suites ?? []),
  ]);
}

async function run(
  directory: string,
  options: { color: string; native: string },
): Promise<{ code: number; output: string }> {
  const require = createRequire(import.meta.url);
  const child = spawn(
    process.execPath,
    [
      require.resolve('@playwright/test/cli'),
      'test',
      '--config',
      join(import.meta.dirname, '../testing/reporting/playwright.config.ts'),
    ],
    {
      cwd: directory,
      env: {
        ...process.env,
        BLACKBOX_PLAYWRIGHT_OUTPUT_DIR: directory,
        // Observer files must stay in the parent-owned cwd despite this legacy override.
        BLACKBOX_PLAYWRIGHT_OBSERVER_DIR: join(directory, 'untrusted-observer'),
        BLACKBOX_TEST_NATIVE_REPORTER: options.native,
        FORCE_COLOR: options.color,
        PLAYWRIGHT_FORCE_TTY: options.color === '1' ? '100x30' : '0',
        NO_COLOR: undefined,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  let output = '';
  let release = Promise.resolve();
  let released = false;
  const record = (chunk: Buffer) => {
    output += chunk.toString('utf8');
    if (!released && output.includes('native-test-output')) {
      released = true;
      release = writeFile(join(directory, 'native-stdout-observed'), 'observed');
    }
  };
  child.stdout.on('data', record);
  child.stderr.on('data', record);
  const timer = setTimeout(() => child.kill('SIGKILL'), 20_000);
  try {
    const code = await new Promise<number>((resolve, reject) => {
      child.once('error', reject);
      child.once('close', (value) => {
        resolve(value ?? 1);
      });
    });
    await release;
    return { code, output };
  } finally {
    clearTimeout(timer);
  }
}
