import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stripVTControlCharacters } from 'node:util';

import { afterEach, describe, expect, it } from 'vitest';

import type { RunManifest, ScenarioRecord } from '../../reporter.js';
import { scenarioVerdict } from './verdict.js';

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

const spikeB2 = 'plain pass|flaky retry|expected to fail|skipped';

// Each case spawns a full Playwright run; leave headroom for loaded CI hosts.
describe(
  'strict verdicts for the spike B2 cases in a real Playwright run',
  { timeout: 60_000 },
  () => {
    it('negative control: native Playwright lets the spike B2 run pass', async () => {
      const native = await run({ verdicts: 'off', grep: spikeB2, maxFailures: '0', list: false });
      expect(native.code, native.output).toBe(0);
      expect(native.output).toContain('1 flaky');
      expect(native.output).toContain('1 skipped');
      expect(native.output).not.toMatch(/^(not )?supported/mu);
    });

    it('fails the spike B2 run and reports each case as not supported', async () => {
      const strict = await run({
        verdicts: 'strict',
        grep: spikeB2,
        maxFailures: '0',
        list: false,
      });
      expect(strict.code, strict.output).toBe(1);
      expect(strict.output).toContain('supported [REQ-100, REQ-102] verdicts.spec.ts › plain pass');
      expect(strict.output).toContain(
        'not supported (flaky) [REQ-200] verdicts.spec.ts › flaky retry',
      );
      expect(strict.output).toContain(
        'not supported (expected-to-fail) [REQ-300] verdicts.spec.ts › expected to fail',
      );
      expect(strict.output).toContain('not supported (skipped) [-] verdicts.spec.ts › skipped');

      const manifest = strict.manifest!;
      expect(manifest).toMatchObject({ schemaVersion: 0, verdicts: 'strict', status: 'failed' });
      expect(manifest.scenarios).toHaveLength(4);
      expect(scenario(manifest, 'plain pass')).toMatchObject({
        verdict: 'supported',
        reasons: [],
        requirements: ['REQ-100', 'REQ-102'],
        location: { file: 'verdicts/verdicts.spec.ts', line: 18 },
        attempts: [{ retry: 0, status: 'passed' }],
      });
      const flaky = scenario(manifest, 'flaky retry');
      expect(flaky).toMatchObject({
        verdict: 'not-supported',
        reasons: ['flaky'],
        outcome: 'flaky',
        attempts: [
          { retry: 0, status: 'failed' },
          { retry: 1, status: 'passed' },
        ],
      });
      const executions = flaky.attempts.map(({ executionId }) => executionId);
      expect(executions.every((id) => typeof id === 'string' && id.length > 0)).toBe(true);
      expect(new Set(executions).size).toBe(2);
      expect(scenario(manifest, 'expected to fail')).toMatchObject({
        verdict: 'not-supported',
        reasons: ['expected-to-fail'],
        expectedStatus: 'failed',
        outcome: 'expected',
      });
      expect(scenario(manifest, 'skipped')).toMatchObject({
        verdict: 'not-supported',
        reasons: ['skipped'],
        requirements: [],
      });
    });

    it('keeps a run whose only test passes plainly green and supported', async () => {
      const result = await run({
        verdicts: 'strict',
        grep: 'plain pass',
        maxFailures: '0',
        list: false,
      });
      expect(result.code, result.output).toBe(0);
      expect(result.output).toContain('supported [REQ-100, REQ-102] verdicts.spec.ts › plain pass');
      expect(result.manifest).toMatchObject({ status: 'passed' });
      expect(result.manifest!.scenarios.map(({ verdict }) => verdict)).toEqual(['supported']);
    });
  },
);

describe('strict verdicts when tests do not run to completion', { timeout: 60_000 }, () => {
  it('reports a test interrupted by maxFailures as not supported', async () => {
    const result = await run({
      verdicts: 'strict',
      grep: 'max failures',
      maxFailures: '1',
      list: false,
    });
    expect(result.code, result.output).toBe(1);
    expect(result.output).toContain('1 interrupted');
    expect(result.output).toContain(
      'not supported (interrupted) [-] verdicts.spec.ts › max failures › interrupted while running',
    );
    expect(scenario(result.manifest!, 'interrupted while running')).toMatchObject({
      verdict: 'not-supported',
      reasons: ['interrupted'],
      attempts: [{ retry: 0, status: 'interrupted' }],
    });
  });

  it('does not turn a --list invocation into a failing verdict run', async () => {
    const result = await run({ verdicts: 'strict', grep: spikeB2, maxFailures: '0', list: true });
    expect(result.code, result.output).toBe(0);
    expect(result.output).toContain('Total: 4 tests in 1 file');
    expect(result.output).not.toMatch(/^(not )?supported/mu);
    expect(result.manifest).toBeNull();
  });
});

describe('scenarioVerdict', () => {
  const verdict = (
    expectedStatus: 'passed' | 'failed' | 'skipped',
    outcome: 'expected' | 'unexpected' | 'flaky' | 'skipped',
    statuses: ('passed' | 'failed' | 'timedOut' | 'skipped' | 'interrupted')[],
  ) =>
    scenarioVerdict({
      expectedStatus,
      outcome: () => outcome,
      results: statuses.map((status) => ({ status })),
    });

  it('supports only one expected, passing attempt', () => {
    expect(verdict('passed', 'expected', ['passed'])).toEqual({
      verdict: 'supported',
      reasons: [],
    });
    expect(verdict('passed', 'flaky', ['failed', 'passed']).reasons).toEqual(['flaky']);
    expect(verdict('passed', 'unexpected', ['timedOut', 'failed']).reasons).toEqual(['failed']);
    expect(verdict('failed', 'expected', ['failed']).reasons).toEqual(['expected-to-fail']);
    expect(verdict('failed', 'unexpected', ['passed']).reasons).toEqual([
      'expected-to-fail',
      'failed',
    ]);
    expect(verdict('skipped', 'skipped', ['skipped']).reasons).toEqual(['skipped']);
  });

  it('does not support a test that never ran or was interrupted', () => {
    expect(verdict('passed', 'skipped', []).reasons).toEqual(['not-run']);
    expect(verdict('passed', 'skipped', ['interrupted']).reasons).toEqual(['interrupted']);
    expect(verdict('passed', 'skipped', ['skipped']).reasons).toEqual(['skipped']);
  });

  it('rejects an expected outcome that still carries a non-passing attempt', () => {
    expect(verdict('passed', 'expected', ['passed', 'timedOut']).reasons).toEqual(['not-passed']);
  });
});

function scenario(manifest: RunManifest, title: string): ScenarioRecord {
  const match = manifest.scenarios.find(({ titlePath }) => titlePath.at(-1) === title);
  expect(match, title).toBeDefined();
  return match!;
}

async function run(options: {
  verdicts: 'strict' | 'off';
  grep: string;
  maxFailures: '0' | '1';
  list: boolean;
}): Promise<{ code: number; output: string; manifest: RunManifest | null }> {
  const directory = await mkdtemp(join(tmpdir(), 'blackbox-verdicts-'));
  directories.push(directory);
  const require = createRequire(import.meta.url);
  const child = spawn(
    process.execPath,
    [
      require.resolve('@playwright/test/cli'),
      'test',
      '--config',
      join(import.meta.dirname, '../../testing/verdicts.config.ts'),
      '--grep',
      options.grep,
      ...(options.list ? ['--list'] : []),
    ],
    {
      cwd: directory,
      env: {
        ...process.env,
        BLACKBOX_PLAYWRIGHT_OUTPUT_DIR: directory,
        BLACKBOX_TEST_VERDICTS: options.verdicts,
        BLACKBOX_TEST_MAX_FAILURES: options.maxFailures,
        CI: undefined,
        FORCE_COLOR: '0',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  let output = '';
  child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString('utf8')));
  child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString('utf8')));
  const timer = setTimeout(() => child.kill('SIGKILL'), 50_000);
  try {
    const code = await new Promise<number>((resolve, reject) => {
      child.once('error', reject);
      child.once('close', (exit) => {
        resolve(exit ?? 1);
      });
    });
    const file = join(directory, 'manifest', 'blackbox-run.json');
    const manifest = (await exists(file))
      ? (JSON.parse(await readFile(file, 'utf8')) as RunManifest)
      : null;
    expect(manifest === null, 'manifest is written only by strict verdict runs').toBe(
      options.verdicts === 'off' || options.list,
    );
    return { code, output: stripVTControlCharacters(output), manifest };
  } finally {
    clearTimeout(timer);
  }
}

async function exists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}
