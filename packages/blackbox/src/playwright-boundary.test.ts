import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { test, type TestContext } from 'vitest';

type CommandResult =
  | { readonly kind: 'success'; readonly stdout: string; readonly stderr: string }
  | { readonly kind: 'failure'; readonly stdout: string; readonly stderr: string };

const mainPackage = fileURLToPath(new URL('../', import.meta.url));
const playwrightPackage = fileURLToPath(
  new URL('../', import.meta.resolve('@suites/blackbox-playwright')),
);
const playwrightTestPackage = join(playwrightPackage, 'node_modules/@playwright/test');
const playwrightCli = join(playwrightTestPackage, 'cli.js');
const typescriptCli = fileURLToPath(new URL('../bin/tsc', import.meta.resolve('typescript')));

const validSpec = `
import { expect, test } from '@suites/blackbox/playwright';
import type {
  BlackboxActivities, BlackboxActivityActions, BlackboxActivityContext, BlackboxScopedRequest,
} from '@suites/blackbox/playwright';

const stimulus = (activities: BlackboxActivities): BlackboxActivityActions => activities.stimulus;
const createOrder = (request: BlackboxScopedRequest) => request.post('/orders');
const traceHeaders = (context: BlackboxActivityContext) => context.headers;

const extended = test.extend<{ readonly tenant: string }>({
  tenant: async ({}, use) => {
    await use('alpha');
  },
});

extended.system('orders', (system) => {
  system.sandbox('isolated', { environment: { TENANT: 'alpha' } }, (sandbox) => {
    sandbox.beforeEach(async ({ sandbox: attempt, tenant }) => {
      await test.step('prepare tenant', async () => {
        expect(attempt.catalogEntry.id).toBe('orders');
        expect(tenant).toBe('alpha');
      });
    });
    sandbox.afterEach(({ effects, telemetry }) => {
      expect(effects.executionId).toBe(telemetry.executionId);
    });
    sandbox.describe('Rule: canonical facade', () => {
      sandbox.test('Scenario: inferred fixtures are available', async ({ activities, effects, request, sandbox }) => {
        await test.step('use native and Blackbox fixtures', async () => {
          expect(request).toBeDefined();
          expect(sandbox.entrypoint.url).toContain('http');
        });
        await stimulus(activities).request('create order', request, createOrder);
        await stimulus(activities).run('custom action', async (context) => {
          expect(traceHeaders(context)).toHaveProperty('traceparent');
        });
        await expect(effects).toSatisfy((e) => [e.exists(e.http({ method: 'POST' }))]);
      });
    });
  });
});
`;

const negativeTypes = `
import { test } from '@suites/blackbox/playwright';
import { defineConfig } from '@suites/blackbox/playwright/config';

const extended = test.extend<{ readonly tenant: string }>({
  tenant: async ({}, use) => use('alpha'),
});

// @ts-expect-error root hooks cannot access attempt-scoped fixtures
extended.beforeAll(({ sandbox }) => void sandbox);
// @ts-expect-error flat root tests must be declared in a system sandbox
extended('flat test', () => undefined);
extended.system('orders', (system) => {
  system.sandbox('isolated', (sandbox) => {
    // @ts-expect-error sandbox suites intentionally have no beforeAll
    sandbox.beforeAll(() => undefined);
  });
});
// @ts-expect-error blackboxConfigFile must be a string
defineConfig({ blackboxConfigFile: 123 });
`;

const validConfig = `
import BlackboxReporter from '@suites/blackbox/playwright/reporter';
import { defineConfig } from '@suites/blackbox/playwright/config';

void BlackboxReporter;
export default defineConfig({
  blackboxConfigFile: './blackbox.config.yaml',
  testDir: '.',
  testMatch: 'journey.spec.ts',
  reporter: [
    ['line'],
    ['@suites/blackbox/playwright/reporter'],
  ],
});
`;

const invalidCatalogConfig = `
import { defineConfig } from '@suites/blackbox/playwright/config';

export default defineConfig({
  blackboxConfigFile: ' ',
  testDir: '.',
  reporter: [['@suites/blackbox/playwright/reporter']],
});
`;

function sourceEnvironment(): NodeJS.ProcessEnv {
  const nodeOptions = process.env.NODE_OPTIONS;
  const condition = '--conditions=blackbox-source';
  return {
    ...process.env,
    NODE_OPTIONS: nodeOptions === undefined ? condition : `${nodeOptions} ${condition}`,
  };
}

function run(executable: string, args: readonly string[], cwd: string): Promise<CommandResult> {
  return new Promise((resolve) => {
    execFile(
      executable,
      [...args],
      { cwd, encoding: 'utf8', env: sourceEnvironment(), maxBuffer: 1024 * 1024 },
      (error, stdout, stderr) => {
        resolve({ kind: error === null ? 'success' : 'failure', stdout, stderr });
      },
    );
  });
}

async function createConsumer(context: TestContext): Promise<string> {
  const project = await mkdtemp(join(tmpdir(), 'blackbox-playwright-facade-'));
  context.onTestFinished(async () => rm(project, { recursive: true, force: true }));
  const suites = join(project, 'node_modules/@suites');
  const playwright = join(project, 'node_modules/@playwright');
  await Promise.all([mkdir(suites, { recursive: true }), mkdir(playwright, { recursive: true })]);
  await Promise.all([
    symlink(mainPackage, join(suites, 'blackbox'), 'dir'),
    symlink(playwrightPackage, join(suites, 'blackbox-playwright'), 'dir'),
    symlink(playwrightTestPackage, join(playwright, 'test'), 'dir'),
    writeFile(join(project, 'package.json'), JSON.stringify({ name: 'consumer', type: 'module' })),
    writeFile(join(project, 'journey.spec.ts'), validSpec),
    writeFile(join(project, 'types-negative.ts'), negativeTypes),
    writeFile(join(project, 'playwright.config.ts'), validConfig),
    writeFile(join(project, 'invalid-catalog.config.ts'), invalidCatalogConfig),
    writeFile(join(project, 'blackbox.config.yaml'), 'systems: {}\n'),
    writeFile(
      join(project, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          customConditions: ['blackbox-source'],
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          noEmit: true,
          resolveJsonModule: true,
          skipLibCheck: true,
          strict: true,
          target: 'ES2022',
        },
        include: ['*.ts'],
      }),
    ),
  ]);
  return project;
}

test('canonical Playwright facade compiles and discovers a consumer journey', async (context) => {
  const project = await createConsumer(context);
  const compiled = await run(
    process.execPath,
    [typescriptCli, '--project', 'tsconfig.json'],
    project,
  );
  assert.equal(compiled.kind, 'success', `${compiled.stdout}\n${compiled.stderr}`);

  const listed = await run(
    process.execPath,
    [playwrightCli, 'test', '--config', 'playwright.config.ts', '--list'],
    project,
  );
  assert.equal(listed.kind, 'success', `${listed.stdout}\n${listed.stderr}`);
  assert.match(
    listed.stdout,
    /system "orders" › sandbox "isolated" › Rule: canonical facade › Scenario: inferred fixtures are available/u,
  );
  assert.match(listed.stdout, /Total: 1 test in 1 file/u);

  const consumerSources = await Promise.all(
    ['journey.spec.ts', 'types-negative.ts', 'playwright.config.ts'].map((file) =>
      readFile(join(project, file), 'utf8'),
    ),
  );
  assert.doesNotMatch(consumerSources.join('\n'), /@suites\/blackbox-playwright/u);

  const invalid = await run(
    process.execPath,
    [playwrightCli, 'test', '--config', 'invalid-catalog.config.ts', '--list'],
    project,
  );
  assert.equal(invalid.kind, 'failure');
  assert.match(
    `${invalid.stdout}\n${invalid.stderr}`,
    /blackboxConfigFile must name the project Blackbox configuration file/u,
  );
});
