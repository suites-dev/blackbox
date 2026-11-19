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

const playwrightPackage = fileURLToPath(new URL('../', import.meta.url));
const playwrightTestPackage = join(playwrightPackage, 'node_modules/@playwright/test');
const playwrightCli = join(playwrightTestPackage, 'cli.js');
const typescriptCli = fileURLToPath(new URL('../bin/tsc', import.meta.resolve('typescript')));

const clientModule = `
import { defineClient } from '@suites/blackbox-playwright';
export const redis = defineClient({}, {
    target: { participant: 'redis', containerPort: 6379 },
    env: [],
    create: () => ({ get: async (key: string): Promise<string | null> => key }),
    ready: () => undefined,
    dispose: () => undefined,
  });

`;

const validSpec = `
import { expect, test } from '@suites/blackbox-playwright';
import { mergeTests, test as base, type TestType } from '@playwright/test';
import * as clients from './clients/index.js';

declare module '@suites/blackbox-playwright' {
  interface BlackboxClients {
    readonly redis: { get(key: string): Promise<string | null> };
  }
}

const extended = test.extend<{ readonly tenant: string }>({
  tenant: async ({}, use) => use('alpha'),
});
const auxiliary = base.extend<{ readonly audit: string }>({
  audit: async ({}, use) => use('native'),
});
const merged = mergeTests(extended, auxiliary);
const native: TestType<import('@suites/blackbox-playwright').BlackboxTestArgs,
  import('@playwright/test').PlaywrightWorkerArgs & import('@playwright/test').PlaywrightWorkerOptions> = test;
void native;

merged.describe('Rule: independent Playwright consumer', { tag: '@acceptance' }, () => {
  merged.use({ blackbox: { system: 'orders', environment: { TENANT: 'alpha' } } });
  merged.beforeAll(({ audit }) => expect(audit).toBe('native'));
  merged.beforeEach(async ({ sandbox: attempt, tenant }) => {
    await test.step('prepare tenant', async () => {
      expect(attempt.catalogEntry.id).toBe('orders');
      expect(tenant).toBe('alpha');
    });
  });
  merged.afterEach(({ effects, telemetry }) => {
    expect(effects.executionId).toBe(telemetry.executionId);
  });
  merged('Scenario: inferred fixtures are available', async ({ request, sandbox }) => {
    await test.step('use native and Blackbox fixtures', async () => {
      expect(request).toBeDefined();
      expect(sandbox.entrypoint.url).toContain('http');
    });
  });
});

extended.describe('typed clients', () => {
  extended.use({ blackbox: { system: { kind: 'subsystem', id: 'product-service' }, clients } });
  extended.beforeEach(async ({ clients, tenant }) => {
    const value: string | null = await clients.redis.get(tenant);
    void value;
  });
  extended.afterEach(({ clients }) => void clients.redis.get('after'));
  extended('Scenario: typed registered clients', async ({ clients, request, tenant }) => {
    const value: string | null = await clients.redis.get(tenant);
    // @ts-expect-error registry names remain exact
    clients.postgres;
    // @ts-expect-error Redis handles retain their SDK methods
    clients.redis.post('/products');
    // @ts-expect-error raw Redis values are not HTTP responses
    value.json();
    void request;
  });
});
test('Scenario: ordinary native test', ({ request }) => void request);
`;

const negativeTypes = `
import { test } from '@suites/blackbox-playwright';
import { defineConfig } from '@suites/blackbox-playwright/config';

// @ts-expect-error facade removed in the breaking native migration
test.system('orders', () => undefined);
// @ts-expect-error old flat option is no longer public
test.use({ catalogEntry: { kind: 'system', id: 'orders' } });
// @ts-expect-error environment values must be strings
test.use({ blackbox: { environment: { PORT: 3000 } } });
// @ts-expect-error final capture and retention have independent boolean options
test.use({ blackbox: { system: 'orders', finalSnapshot: 'off' } });
// @ts-expect-error blackboxConfigFile must be a string
defineConfig({ blackboxConfigFile: 123 });
`;

const validConfig = `
import BlackboxReporter from '@suites/blackbox-playwright/reporter';
import { defineConfig } from '@suites/blackbox-playwright/config';

void BlackboxReporter;
export default defineConfig({
  blackboxConfigFile: './blackbox.config.yaml',
  testDir: '.',
  testMatch: 'journey.spec.ts',
  reporter: [
    ['line'],
    ['@suites/blackbox-playwright/reporter', { sandboxLifecycle: true }],
  ],
});
`;

const invalidReporterConfig = `
import { defineConfig } from '@suites/blackbox-playwright/config';

export default defineConfig({
  blackboxConfigFile: './blackbox.config.yaml',
  testDir: '.',
  reporter: [['@suites/blackbox-playwright/reporter', { sandboxLifecycle: 'yes' }]],
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
  const project = await mkdtemp(join(tmpdir(), 'blackbox-playwright-consumer-'));
  context.onTestFinished(async () => rm(project, { recursive: true, force: true }));
  const suites = join(project, 'node_modules/@suites');
  const playwright = join(project, 'node_modules/@playwright');
  await Promise.all([
    mkdir(suites, { recursive: true }),
    mkdir(playwright, { recursive: true }),
    mkdir(join(project, 'clients'), { recursive: true }),
  ]);
  await Promise.all([
    symlink(playwrightPackage, join(suites, 'blackbox-playwright'), 'dir'),
    symlink(playwrightTestPackage, join(playwright, 'test'), 'dir'),
    writeFile(join(project, 'package.json'), JSON.stringify({ name: 'consumer', type: 'module' })),
    writeFile(join(project, 'journey.spec.ts'), validSpec),
    writeFile(join(project, 'clients/redis.ts'), clientModule),
    writeFile(join(project, 'clients/index.ts'), "export { redis } from './redis.js';\n"),
    writeFile(join(project, 'types-negative.ts'), negativeTypes),
    writeFile(join(project, 'playwright.config.ts'), validConfig),
    writeFile(join(project, 'invalid-reporter.config.ts'), invalidReporterConfig),
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

test('independent Playwright consumer compiles and discovers a journey', async (context) => {
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
    /Rule: independent Playwright consumer › Scenario: inferred fixtures are available/u,
  );
  assert.match(listed.stdout, /Total: 3 tests in 1 file/u);

  assert.match(listed.stdout, /typed clients › Scenario: typed registered clients/u);
  assert.match(listed.stdout, /Scenario: ordinary native test/u);

  const consumerSources = await Promise.all(
    [
      'journey.spec.ts',
      'types-negative.ts',
      'playwright.config.ts',
      'invalid-reporter.config.ts',
    ].map((file) => readFile(join(project, file), 'utf8')),
  );
  assert.doesNotMatch(consumerSources.join('\n'), /@suites\/blackbox\/playwright/u);

  const invalid = await run(
    process.execPath,
    [playwrightCli, 'test', '--config', 'invalid-reporter.config.ts', '--list'],
    project,
  );
  assert.equal(invalid.kind, 'failure');
  assert.match(
    `${invalid.stdout}\n${invalid.stderr}`,
    /Blackbox reporter sandboxLifecycle must be a boolean/u,
  );
});
