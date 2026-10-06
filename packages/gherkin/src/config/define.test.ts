import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { GherkinConfigError } from '../project/config.js';
import clearManifests, { MANIFESTS_METADATA_KEY } from './clear-manifests.js';
import { defineGherkinConfig, GENERATED_TESTS } from './define.js';

// Requirements (task 2.4, report sections 4.4 and 5.2): defineGherkinConfig
// runs only the generated tests, sets failOnFlakyTests and forbidOnly, and adds
// the Blackbox reporter with strict verdicts, the run manifest and the policy
// baseline from blackbox.feature.yaml. It throws when a caller sets any of
// these itself, instead of letting a config override them silently. Its
// global setup deletes both manifests before any test runs (benchmark F1), so
// a run without the Blackbox reporter cannot leave an earlier run's behind.

let root = '';
let gherkinConfigFile = '';
const reporterFile = createRequire(import.meta.url).resolve('@suites/blackbox-playwright/reporter');
const clearManifestsFile = fileURLToPath(new URL('./clear-manifests.ts', import.meta.url));

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'blackbox-gherkin-config-'));
  gherkinConfigFile = join(root, 'blackbox.feature.yaml');
  await writeFile(
    gherkinConfigFile,
    JSON.stringify({
      schemaVersion: 1,
      blackboxConfigFile: 'blackbox.config.yaml',
      features: ['features/**/*.feature'],
      outputDir: '.features-gen',
      runManifest: 'results/blackbox-run.json',
      policy: { baseline: 'blackbox.policy.yaml', outputFile: 'results/blackbox-policy.yaml' },
      sandboxes: { default: {} },
    }),
  );
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('defineGherkinConfig', () => {
  it('runs the generated tests with strict verdicts, the run manifest and the policy baseline', () => {
    const config = defineGherkinConfig({ gherkinConfigFile, workers: 2, retries: 0, reporter: [['dot']] });
    expect(config).toMatchObject({
      testDir: join(root, '.features-gen'),
      testMatch: GENERATED_TESTS,
      failOnFlakyTests: true,
      forbidOnly: true,
      workers: 2,
      retries: 0,
      reporter: [
        ['dot'],
        [
          reporterFile,
          {
            verdicts: 'strict',
            runManifest: join(root, 'results/blackbox-run.json'),
            policy: { baseline: join(root, 'blackbox.policy.yaml'), outputFile: join(root, 'results/blackbox-policy.yaml') },
          },
        ],
      ],
      metadata: { blackboxConfigFile: join(root, 'blackbox.config.yaml'), blackboxSandboxLifecycle: true },
    });
  });

  it('clears both manifests in a global setup that runs before the caller\'s own', () => {
    const manifests = [join(root, 'results/blackbox-run.json'), join(root, 'results/blackbox-policy.yaml')];
    expect(defineGherkinConfig({ gherkinConfigFile })).toMatchObject({
      globalSetup: [clearManifestsFile],
      metadata: { [MANIFESTS_METADATA_KEY]: manifests },
    });
    expect(
      defineGherkinConfig({ gherkinConfigFile, globalSetup: './setup.ts', metadata: { [MANIFESTS_METADATA_KEY]: [] } }),
    ).toMatchObject({
      globalSetup: [clearManifestsFile, './setup.ts'],
      metadata: { [MANIFESTS_METADATA_KEY]: manifests },
    });
    expect(defineGherkinConfig({ gherkinConfigFile, globalSetup: ['./a.ts', './b.ts'] }).globalSetup).toEqual([
      clearManifestsFile,
      './a.ts',
      './b.ts',
    ]);
  });

  it('accepts a file URL and keeps the list reporter when none is configured', () => {
    const config = defineGherkinConfig({ gherkinConfigFile: pathToFileURL(gherkinConfigFile) });
    expect(config.reporter).toEqual([['list'], [reporterFile, expect.objectContaining({ verdicts: 'strict' })]]);
  });

  it.each([
    ['testDir', { testDir: 'tests' }],
    ['testMatch', { testMatch: '**/*.spec.ts' }],
    ['testIgnore', { testIgnore: '**/skip/**' }],
    ['failOnFlakyTests', { failOnFlakyTests: false }],
    ['forbidOnly', { forbidOnly: false }],
    ['blackboxConfigFile', { blackboxConfigFile: 'other.yaml' }],
  ])('refuses a caller that sets %s', (key, setting) => {
    expect(() => defineGherkinConfig({ gherkinConfigFile, ...setting })).toThrow(
      `defineGherkinConfig sets ${key}; remove it from the config`,
    );
  });

  it('refuses project-level test selection and a caller-supplied Blackbox reporter', () => {
    expect(() =>
      defineGherkinConfig({ gherkinConfigFile, projects: [{ name: 'a' }, { name: 'b', testMatch: '**/*.ts' }] }),
    ).toThrow('defineGherkinConfig sets testMatch (projects[1]); remove it from the config');
    expect(() =>
      defineGherkinConfig({ gherkinConfigFile, reporter: [['@suites/blackbox-playwright/reporter', { verdicts: 'strict' }]] }),
    ).toThrow('defineGherkinConfig adds the Blackbox reporter with strict verdicts; remove it from reporter');
  });

  it('refuses a relative project file path and an invalid project file', async () => {
    expect(() => defineGherkinConfig({ gherkinConfigFile: 'blackbox.feature.yaml' })).toThrow('gherkinConfigFile must be absolute');
    const invalid = join(root, 'invalid.feature.yaml');
    await writeFile(invalid, JSON.stringify({ schemaVersion: 1 }));
    expect(() => defineGherkinConfig({ gherkinConfigFile: invalid })).toThrow(GherkinConfigError);
  });
});

describe('the global setup', () => {
  const exists = (file: string) => access(file).then(
    () => true,
    () => false,
  );

  it('deletes the listed manifests and tolerates one that is already gone', async () => {
    const dir = join(root, 'clear');
    await mkdir(dir, { recursive: true });
    const run = join(dir, 'blackbox-run.json');
    await writeFile(run, '{}');
    await clearManifests({ metadata: { [MANIFESTS_METADATA_KEY]: [run, join(dir, 'blackbox-policy.yaml')] } });
    expect(await exists(run)).toBe(false);
  });

  it('refuses a config that does not list absolute manifest paths', async () => {
    for (const metadata of [{}, { [MANIFESTS_METADATA_KEY]: ['results/blackbox-run.json'] }]) {
      await expect(clearManifests({ metadata })).rejects.toThrow('build the config with defineGherkinConfig');
    }
  });
});
