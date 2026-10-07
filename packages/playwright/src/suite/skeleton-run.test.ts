import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { JSONReport, JSONReportTestResult } from '@playwright/test/reporter';
import { afterEach, describe, expect, it } from 'vitest';

import { STUB_TOKEN } from '../library/testing/stub-system.js';
import { renderSuite, SUITE_RUNTIME_MODULE } from './render/render.js';
import { sentences } from './sentences.js';
import { FEATURE, READY, SUBSCRIBE, TOKEN_VARIABLE } from './testing/feature.js';

// Requirement: a rendered skeleton is a runnable Playwright suite. Run for
// real by `playwright test` against the library's subscription stub, every
// library step passes and the TODO step fails with 'TODO: step not in
// library', so its test fails. The only change to the rendered text is the
// module it imports, which points at a runtime whose attempts start the stub
// instead of a Docker Sandbox.

const RUNTIME = join(import.meta.dirname, 'testing', 'skeleton-runtime.fixture.ts');
const CONFIG = join(import.meta.dirname, 'testing', 'skeleton.config.ts');
const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function runPlaywright(
  directory: string,
): Promise<{ readonly code: number; readonly output: string }> {
  const require = createRequire(import.meta.url);
  const child = spawn(
    process.execPath,
    [require.resolve('@playwright/test/cli'), 'test', '--config', CONFIG],
    {
      cwd: join(import.meta.dirname, '..', '..'),
      env: {
        ...process.env,
        BLACKBOX_SKELETON_DIR: directory,
        BLACKBOX_PLAYWRIGHT_OUTPUT_DIR: join(directory, 'output'),
        BLACKBOX_PLAYWRIGHT_JSON_REPORT: join(directory, 'report.json'),
        [TOKEN_VARIABLE]: STUB_TOKEN,
        FORCE_COLOR: '0',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  let output = '';
  const collect = (chunk: Buffer) => {
    output += chunk.toString('utf8');
  };
  child.stdout.on('data', collect);
  child.stderr.on('data', collect);
  const timer = setTimeout(() => child.kill('SIGKILL'), 240_000);
  const code = await new Promise<number>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (exitCode) => {
      resolve(exitCode ?? 1);
    });
  }).finally(() => {
    clearTimeout(timer);
  });
  return { code, output };
}

function resultOf(report: JSONReport, title: string): JSONReportTestResult {
  const specs = report.suites.flatMap(
    function specsOf(suite): JSONReport['suites'][number]['specs'] {
      return [...suite.specs, ...(suite.suites ?? []).flatMap(specsOf)];
    },
  );
  const spec = specs.find((candidate) => candidate.title === title);
  if (spec === undefined || spec.tests.length !== 1 || spec.tests[0].results.length !== 1) {
    throw new Error(`report has no single result for ${title}`);
  }
  return spec.tests[0].results[0];
}

const stepOutcomes = (result: JSONReportTestResult) =>
  (result.steps ?? []).map((step) => [
    step.title,
    step.error === undefined ? 'passed' : step.error.message,
  ]);

describe('a rendered skeleton under playwright test', () => {
  it('passes its library steps against a stub system and fails at the TODO step', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'blackbox-skeleton-'));
    directories.push(directory);
    const source = renderSuite(FEATURE, sentences);
    expect(source).toContain(`from '${SUITE_RUNTIME_MODULE}';`);
    // An ES module project, as the package's consumers are.
    await writeFile(join(directory, 'package.json'), '{ "type": "module" }\n');
    await writeFile(
      join(directory, 'subscription.spec.ts'),
      source.replace(`'${SUITE_RUNTIME_MODULE}'`, JSON.stringify(RUNTIME)),
    );

    const run = await runPlaywright(directory);
    expect(run.code, run.output).toBe(1);
    const report = JSON.parse(await readFile(join(directory, 'report.json'), 'utf8')) as JSONReport;

    const ready = resultOf(report, READY);
    expect(ready.status, run.output).toBe('passed');
    expect(stepOutcomes(ready)).toEqual([
      ['When the client sends GET "/health"', 'passed'],
      ['Then the response status is 200', 'passed'],
      ['And the response has "/status" equal to:', 'passed'],
    ]);

    const subscribe = resultOf(report, SUBSCRIBE);
    expect(subscribe.status).toBe('failed');
    expect(stepOutcomes(subscribe)).toEqual([
      ['When the client sends POST "/subscriptions" with JSON:', 'passed'],
      ['Then the response status is 201', 'passed'],
      [
        'And the state at "/fixture/state" as "fixture-control" has 1 item at "/subscriptions"',
        'passed',
      ],
      [
        "And the user's welcome email is sent",
        expect.stringContaining('TODO: step not in library'),
      ],
    ]);
  }, 270_000);
});
