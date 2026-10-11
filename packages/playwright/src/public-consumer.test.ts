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
import * as clients from './clients/index.js';

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
    sandbox.describe('Rule: independent Playwright consumer', () => {
      sandbox.test('Scenario: inferred fixtures are available', async ({ request, sandbox }) => {
        await test.step('use native and Blackbox fixtures', async () => {
          expect(request).toBeDefined();
          expect(sandbox.entrypoint.url).toContain('http');
        });
      });
    });
  });
});

extended.system.sandbox({ kind: 'subsystem', id: 'product-service' }, { clients }, (suite) => {
  suite.beforeEach(async ({ clients, tenant }) => {
    const value: string | null = await clients.redis.get(tenant);
    void value;
  });
  suite.afterEach(({ clients }) => void clients.redis.get('after'));
  suite.test('Scenario: typed registered clients', async ({ clients, request, tenant }) => {
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
test.system.sandbox('plain', (suite) => {
  suite.test('Scenario: default sandbox shorthand', ({ sandbox }) => void sandbox);
});
`;

const negativeTypes = `
import { test } from '@suites/blackbox-playwright';
import { defineConfig } from '@suites/blackbox-playwright/config';

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
    /system "orders" › sandbox "isolated" › Rule: independent Playwright consumer › Scenario: inferred fixtures are available/u,
  );
  assert.match(listed.stdout, /Total: 3 tests in 1 file/u);

  assert.match(
    listed.stdout,
    /subsystem "product-service" › sandbox "default" › Scenario: typed registered clients/u,
  );
  assert.match(
    listed.stdout,
    /system "plain" › sandbox "default" › Scenario: default sandbox shorthand/u,
  );

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
