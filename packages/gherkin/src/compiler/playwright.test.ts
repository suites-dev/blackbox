import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { compileFeatures } from './compile.js';
import { testContext } from './testing/context.js';
import { runPlaywright, stubRuntimeModule } from './testing/playwright-cli.js';

// Generated tests run under the real Playwright test CLI, not the recording
// facade: a passing stub step passes the run, and a failing one fails it with a
// nonzero exit and the failing test reported. The runtime module substitutes only
// the stub steps and Sandbox acquisition (see testing/playwright-runtime.ts).

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
  readonly feature: string;
  readonly report: {
    readonly stats: { readonly expected: number; readonly unexpected: number };
    readonly suites: unknown;
  };
}

/** The `location` of every test error in a JSON report subtree. */
function reportedLocations(node: unknown): readonly unknown[] {
  if (Array.isArray(node)) {
    return node.flatMap(reportedLocations);
  }
  if (typeof node !== 'object' || node === null) {
    return [];
  }
  const own =
    'errors' in node && Array.isArray(node.errors)
      ? node.errors.map((error: unknown) =>
          typeof error === 'object' && error !== null && 'location' in error ? error.location : null,
        )
      : [];
  return [...own, ...Object.values(node).flatMap(reportedLocations)];
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
    runtimeModule: stubRuntimeModule,
  });
  const { code, output } = await runPlaywright(root, ['--config', 'playwright.config.mjs']);
  const report = JSON.parse(await readFile(join(root, 'results.json'), 'utf8')) as Run['report'];
  return { code, output, feature: join(root, 'features/stub.feature'), report };
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

  it('reports the failing step at its .feature line, not the generated spec', async () => {
    const run = await compileAndRun(500);
    expect(reportedLocations(run.report.suites)).toEqual([
      { file: run.feature, line: 9, column: 5 },
    ]);
    expect(run.output).toContain(`at ${run.feature}:9:5`);
    expect(run.output).toMatch(/>\s+9 \|\s+Then the response status is 500/u);
  });
});
