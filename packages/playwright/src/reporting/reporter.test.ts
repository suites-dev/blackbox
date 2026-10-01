import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, it } from 'vitest';

import type { JSONReport } from '@playwright/test/reporter';

it('streams before setup can finish and retains isolated retry, failure and nested-step evidence', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'blackbox-reporter-'));
  try {
    const result = await run(directory);
    expect(result.code, result.output).toBe(1);
    expect(result.output).not.toContain('Reporter did not publish progress');
    expect(result.output).not.toContain('Config was not resolved');
    expect(result.output).not.toContain('synthetic-secret');
    expect(result.output).not.toContain('\u001b');
    expect(result.output).not.toContain('artifacts: ../');
    expect(result.output).toMatch(/passed · \d+ms total/u);
    expect(result.output).toContain(
      'Given an eligible customer › When a subscription is requested',
    );
    expect(result.output).toContain('1 expected, 2 unexpected, 1 flaky, 0 skipped · 5 attempts');
    const report = JSON.parse(
      await readFile(join(directory, 'results.json'), 'utf8'),
    ) as JSONReport;
    const serialized = JSON.stringify(report);
    expect(serialized).not.toContain('BODY_MUST_NOT_EXECUTE');
    const allResults = resultsIn(report.suites);
    expect(allResults).toHaveLength(5);
    const transcripts = allResults.map((attempt) => {
      const retained = attempt.attachments.find(({ name }) => name === 'blackbox-attempt');
      expect(retained).toBeDefined();
      return Buffer.from(retained!.body!, 'base64').toString('utf8');
    });
    expect(transcripts.join('\n')).not.toContain('synthetic-secret');
    const reportedDurations = [...result.output.matchAll(/· (\d+)ms total/gu)].map((match) =>
      Number(match[1]),
    );
    const lastEventTimes = transcripts.map((text) => {
      const report = JSON.parse(text) as { events: { elapsedMs: number }[] };
      return Math.max(...report.events.map(({ elapsedMs }) => elapsedMs));
    });
    expect(reportedDurations).toHaveLength(5);
    expect(Math.max(...reportedDurations)).toBeGreaterThanOrEqual(Math.max(...lastEventTimes));
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

function resultsIn(
  suites: JSONReport['suites'],
): JSONReport['suites'][number]['specs'][number]['tests'][number]['results'] {
  return suites.flatMap((suite) => [
    ...suite.specs.flatMap((spec) => spec.tests.flatMap((test) => test.results)),
    ...resultsIn(suite.suites ?? []),
  ]);
}

async function run(directory: string): Promise<{ code: number; output: string }> {
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
      env: {
        ...process.env,
        BLACKBOX_PLAYWRIGHT_OUTPUT_DIR: directory,
        FORCE_COLOR: '0',
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
    if (!released && output.includes('→ acquisition: waiting for reporter handshake')) {
      released = true;
      release = writeFile(join(directory, 'reporter-observed-startup'), 'observed');
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
