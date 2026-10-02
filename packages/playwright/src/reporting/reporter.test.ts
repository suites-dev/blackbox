import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stripVTControlCharacters } from 'node:util';

import { expect, it } from 'vitest';

import type { JSONReport } from '@playwright/test/reporter';

function expectNativeOutput(
  result: { code: number; output: string },
  options: { color: string; native: string },
): void {
  const output = stripVTControlCharacters(result.output);
  expect(result.code, result.output).toBe(1);
  expect(result.output).not.toContain('Reporter did not publish progress');
  expect(result.output).not.toContain('Config was not resolved');
  expect(result.output).not.toContain('synthetic-secret');
  expect(result.output.includes('\u001b')).toBe(options.color === '1');
  expect(output).toContain('Running 4 tests using 2 workers');
  expect(output).toContain('2 failed');
  expect(output).toContain('1 flaky');
  expect(output).toContain('1 passed');
  expect(output.match(/native-test-output/gu)).toHaveLength(1);
  expect(output.match(/native-test-error-output/gu)).toHaveLength(1);
  expect(output).not.toContain('Blackbox ·');
  expect(output).not.toMatch(/^\[\d+\]\s+[·✓→]/mu);
  if (options.native === 'list') {
    expect(output).toContain('Given an eligible customer');
    expect(output).toContain('When a subscription is requested');
  }
}

it.each([
  { lifecycle: 'on', color: '0', native: 'list' },
  { lifecycle: 'on', color: '1', native: 'list' },
  { lifecycle: 'off', color: '1', native: 'list' },
  { lifecycle: 'on', color: '0', native: 'auto' },
])('preserves native output and isolated attempt evidence (%j)', async (options) => {
  const directory = await mkdtemp(join(tmpdir(), 'blackbox-reporter-'));
  try {
    const result = await run(directory, options);
    const output = stripVTControlCharacters(result.output);
    expectNativeOutput(result, options);
    const report = JSON.parse(
      await readFile(join(directory, 'results.json'), 'utf8'),
    ) as JSONReport;
    const allResults = resultsIn(report.suites);
    expect(allResults).toHaveLength(5);
    expect(allResults.flatMap(({ stdout }) => stdout.map(stdioText)).join('')).not.toContain(
      'containers acquired',
    );
    const business = allResults.find((attempt) =>
      attempt.stdout.some((chunk) => stdioText(chunk).includes('native-test-output')),
    )!;
    const stdout = business.stdout.map(stdioText).join('');
    if (options.lifecycle === 'on') {
      expect(stdout).toMatch(
        /Blackbox: sandbox ready for system "orders"[\s\S]*native-test-output[\s\S]*Blackbox: sandbox cleaned up for system "orders"/u,
      );
      expect(output.match(/Blackbox: sandbox ready for /gu)).toHaveLength(4);
      expect(output.match(/Blackbox: sandbox cleaned up for /gu)).toHaveLength(3);
      expect(output.match(/Blackbox: sandbox cleanup failed for /gu)).toHaveLength(1);
    } else {
      expect(output).not.toContain('Blackbox: sandbox');
    }
    // Error snippets may quote the unexecuted body. Observe execution, not source text.
    expect(
      allResults.flatMap(({ attachments }) => attachments.map(({ name }) => name)),
    ).not.toContain('setup-body-entered');
    const messages = allResults.flatMap(({ error }) =>
      error === undefined ? [] : [error.message ?? ''],
    );
    expect(messages.some((message) => message.includes('synthetic setup failure'))).toBe(true);
    expect(messages.some((message) => message.includes('BODY_MUST_NOT_EXECUTE'))).toBe(false);
    const transcripts = allResults.map((attempt) => {
      const diagnostics = attempt.attachments.find(({ name }) => name === 'blackbox-diagnostics');
      expect(diagnostics).toBeDefined();
      const retained = attempt.attachments.find(({ name }) => name === 'blackbox-attempt');
      expect(retained).toBeDefined();
      const text = Buffer.from(retained!.body!, 'base64').toString('utf8');
      const document = JSON.parse(text) as {
        owner: Record<string, unknown>;
        events: { phase: string; sandboxId: string | null }[];
      };
      // Every event names the one sandbox that owns it, so attempts stay distinguishable.
      const owners = new Set(document.events.map(({ sandboxId }) => sandboxId));
      expect(owners.size).toBe(1);
      const [sandboxId] = owners;
      expect(sandboxId).toMatch(/^[a-f0-9-]{36}$/u);
      expect(Buffer.from(diagnostics!.body!, 'base64').toString('utf8')).toContain(
        `[${sandboxId}] acquisition: started`,
      );
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
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

function stdioText(chunk: { text: string } | { buffer: string }): string {
  return 'text' in chunk ? chunk.text : Buffer.from(chunk.buffer, 'base64').toString('utf8');
}

function resultsIn(
  suites: JSONReport['suites'],
): (JSONReport['suites'][number]['specs'][number]['tests'][number]['results'][number] & {
  testId: string;
})[] {
  return suites.flatMap((suite) => [
    ...suite.specs.flatMap((spec) =>
      spec.tests.flatMap((test) => test.results.map((result) => ({ ...result, testId: spec.id }))),
    ),
    ...resultsIn(suite.suites ?? []),
  ]);
}

async function run(
  directory: string,
  options: { lifecycle: string; color: string; native: string },
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
        BLACKBOX_TEST_LIFECYCLE: options.lifecycle,
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
      child.once('close', (code) => {
        resolve(code ?? 1);
      });
    });
    await release;
    return { code, output };
  } finally {
    clearTimeout(timer);
  }
}
