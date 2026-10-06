import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { compileFeatures } from './compile.js';
import { testContext } from './testing/context.js';

// Generated tests run under the real Playwright test CLI, not the recording
// facade: a passing stub step passes the run, and a failing one fails it with a
// nonzero exit and the failing test reported. The runtime module substitutes only
// the stub steps and Sandbox acquisition (see testing/playwright-runtime.ts).

const runtimeModule = pathToFileURL(
  fileURLToPath(new URL('./testing/playwright-runtime.ts', import.meta.url)),
).href;

// The CLI must be the @playwright/test instance that @suites/blackbox-playwright
// imports, so it is resolved from that package. Spawning it is not an import.
async function playwrightCli(): Promise<string> {
  const dependency = fileURLToPath(
    new URL('../../node_modules/@suites/blackbox-playwright/package.json', import.meta.url),
  );
  return createRequire(await realpath(dependency)).resolve('@playwright/test/cli');
}

const CONFIG = `export default {
  testDir: '.features-gen',
  workers: 1,
  retries: 0,
  reporter: [['list'], ['json', { outputFile: 'results.json' }]],
};
`;

const feature = (status: number): string => `@system:subscription-system @sandbox:bare
Feature: stub system

  Background:
    Given the flow is sealed by the terminal response

  @requirement:REQ-1
  Scenario: the stub claim
    Then the response status is ${status}
`;

interface Run {
  readonly code: number;
  readonly output: string;
  readonly report: {
    readonly stats: { readonly expected: number; readonly unexpected: number };
    readonly suites: readonly unknown[];
  };
}

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function compileAndRun(status: number): Promise<Run> {
  const root = await mkdtemp(join(tmpdir(), 'blackbox-gherkin-playwright-'));
  roots.push(root);
  await mkdir(join(root, 'features'));
  await writeFile(join(root, 'features/stub.feature'), feature(status));
  await writeFile(join(root, 'playwright.config.mjs'), CONFIG);
  await compileFeatures({
    rootDir: root,
    outputDir: join(root, '.features-gen'),
    features: ['features/stub.feature'],
    context: testContext(),
    runtimeModule,
  });
  const cli = await playwrightCli();
  const { code, output } = await new Promise<{ code: number; output: string }>((resolve) => {
    execFile(
      process.execPath,
      [cli, 'test', '--config', 'playwright.config.mjs'],
      {
        cwd: root,
        encoding: 'utf8',
        // Workspace packages resolve to their sources, as the package tests do.
        env: {
          ...process.env,
          NODE_OPTIONS: [process.env.NODE_OPTIONS, '--conditions=blackbox-source']
            .filter(Boolean)
            .join(' '),
          FORCE_COLOR: '0',
        },
        timeout: 90_000,
      },
      (error, stdout, stderr) => {
        const exit = error === null ? 0 : typeof error.code === 'number' ? error.code : 1;
        resolve({ code: exit, output: `${stdout}\n${stderr}` });
      },
    );
  });
  const report = JSON.parse(await readFile(join(root, 'results.json'), 'utf8')) as Run['report'];
  return { code, output, report };
}

describe('generated tests under the real Playwright test CLI', { timeout: 120_000 }, () => {
  it('passes the run when the stub step passes', async () => {
    const run = await compileAndRun(200);
    expect(run.code, run.output).toBe(0);
    expect(run.report.stats).toMatchObject({ expected: 1, unexpected: 0 });
    expect(run.output).toContain('Scenario: the stub claim');
  });

  it('fails the run and reports the failing test when the stub step fails', async () => {
    const run = await compileAndRun(500);
    expect(run.code, run.output).not.toBe(0);
    expect(run.report.stats).toMatchObject({ expected: 0, unexpected: 1 });
    expect(run.output).toContain('1 failed');
    expect(run.output).toMatch(/✘.*Scenario: the stub claim/u);
    expect(run.output).toContain('stub response status is 200, not 500');
  });
});
