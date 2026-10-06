import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Config } from '@oclif/core';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { stringify } from 'yaml';

import { git } from '../check/git.js';
import { cleanupRepositories, repository } from '../check/testing/repository.js';
import FeatureCheck from './commands/feature/check.js';
import FeatureCheckChange from './commands/feature/check-change.js';
import FeatureCompile from './commands/feature/compile.js';
import FeatureSteps from './commands/feature/steps.js';
import FeatureVerify from './commands/feature/verify.js';
import { COMMANDS } from './command-registry.js';

// Requirements (task 2.4): the `blackbox feature` topic offers compile, check,
// check-change, verify and steps. Each command reads blackbox.feature.yaml,
// exits 0 when its check passes, 1 when it fails and 2 when the project file
// is missing or invalid. compile uses the shared library and the project's
// catalog, and prints requirement IDs and barrier deadlines.

const CATALOG = `schemaVersion: 1
catalog:
  default: subscription-system
  entries:
    subscription-system:
      kind: system
      acquisition: { adapter: docker-compose@1, files: [compose.yml] }
      entrypoint: { participant: api, protocol: http, containerPort: 3000, readiness: { path: /health, timeoutMs: 30000 } }
      participants:
        api: { service: api, role: entrypoint, runtime: node, activation: node-runtime }
      drivers: {}
      observation:
        policyId: api-v1
        boundaries:
          - { id: effects.http, kind: http, authoritativeFor: [HTTP effects] }
        requiredBoundaries: [effects.http]
        terminalObservationWindowMs: 500
        redaction: { requestBodies: not-captured, headers: [authorization], dynamicIdentifiers: normalized }
activations:
  node-runtime: { ref: bootstrap.mjs, adapter: node-factory, version: 1 }
`;

const HEALTH = `@system:subscription-system @sandbox:default @requirement:REQ-7
Feature: health

  Scenario: the public API reports ready
    When the client sends GET "/health"
    Then the flow is sealed within 5 seconds when the state at "/fixture/state" as "fixture-control" has 0 items at "/orders"
    And the response status is 200
`;

const PROJECT = {
  schemaVersion: 1,
  blackboxConfigFile: 'blackbox.config.yaml',
  features: ['features/**/*.feature'],
  outputDir: '.features-gen',
  runManifest: 'results/blackbox-run.json',
  policy: { baseline: 'blackbox.policy.yaml', outputFile: 'results/blackbox-policy.yaml' },
  sandboxes: { default: { credentials: { 'fixture-control': { scheme: 'bearer', fromEnv: 'FIXTURE_TOKEN' } } } },
};

let root = '';
let config = '';
let oclifRoot = '';

// Commands run through oclif, as the CLI host runs them, from a bare oclif root
// so the test never loads a built command registry.
beforeAll(async () => {
  oclifRoot = await mkdtemp(join(tmpdir(), 'blackbox-gherkin-oclif-'));
  await writeFile(join(oclifRoot, 'package.json'), JSON.stringify({ name: 'gherkin-command-test', version: '0.0.0', oclif: {} }));
});

afterAll(async () => {
  await rm(oclifRoot, { recursive: true, force: true });
});

interface CommandRun {
  readonly exit: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** The exit code oclif attached to a thrown exit or error, or -1 for anything else. */
function oclifExit(error: unknown): number {
  const oclif = typeof error === 'object' && error !== null && 'oclif' in error ? error.oclif : null;
  return typeof oclif === 'object' && oclif !== null && 'exit' in oclif && typeof oclif.exit === 'number' ? oclif.exit : -1;
}

type FeatureCommand =
  | typeof FeatureCheck
  | typeof FeatureCheckChange
  | typeof FeatureCompile
  | typeof FeatureSteps
  | typeof FeatureVerify;

async function runCommand(command: FeatureCommand, argv: readonly string[]): Promise<CommandRun> {
  let stdout = '';
  let stderr = '';
  const loaded = await Config.load({ root: oclifRoot });
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => (stdout += String(chunk)) !== '');
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk: string | Uint8Array) => (stderr += String(chunk)) !== '');
  vi.spyOn(console, 'log').mockImplementation((...parts: unknown[]) => (stdout += `${parts.map(String).join(' ')}\n`));
  vi.spyOn(console, 'error').mockImplementation((...parts: unknown[]) => (stderr += `${parts.map(String).join(' ')}\n`));
  let exit = 0;
  try {
    await command.run([...argv], loaded);
  } catch (error) {
    exit = oclifExit(error);
    if (exit === -1) {
      throw error;
    }
    // oclif's static run leaves rendering a failure to the bin's error handler.
    stderr += `${(error as Error).message}\n`;
  } finally {
    vi.restoreAllMocks();
  }
  return { exit, stdout, stderr };
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'blackbox-gherkin-cli-'));
  config = join(root, 'blackbox.feature.yaml');
  await mkdir(join(root, 'features'), { recursive: true });
  await writeFile(join(root, 'blackbox.config.yaml'), CATALOG);
  await writeFile(config, stringify(PROJECT));
  await writeFile(join(root, 'features/health.feature'), HEALTH);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
  await cleanupRepositories();
});

describe('blackbox feature compile', () => {
  it('compiles the accepted features with the shared library', async () => {
    const run = await runCommand(FeatureCompile, ['--config', config]);
    expect(run.exit, run.stderr).toBe(0);
    expect(run.stdout.split('\n')[0]).toBe(
      'features/health.feature:4 [REQ-7] Scenario: the public API reports ready (barrier deadlines: 5s at line 6)',
    );
    expect(run.stdout).toMatch(/^compiled 1 feature\(s\) into 1 scenario\(s\) in \.features-gen\/ with compile-manifest\.json; step library @suites\/blackbox-gherkin@/mu);
    const generated = await readFile(join(root, '.features-gen/features/health.feature.spec.mjs'), 'utf8');
    expect(generated).toContain('from "@suites/blackbox-gherkin";');
    expect(generated).toContain('const credentials = sandboxCredentials({"fixture-control":{"scheme":"bearer","fromEnv":"FIXTURE_TOKEN"}});');
  });

  it('fails with every diagnostic and generates nothing when a credential is not in the profile', async () => {
    await writeFile(join(root, 'features/health.feature'), HEALTH.replace('"fixture-control"', '"admin"'));
    const run = await runCommand(FeatureCompile, ['--config', config]);
    expect(run.exit).toBe(1);
    expect(run.stderr).toContain('features/health.feature:6:5: credential "admin" is not defined by Sandbox profile "default" (it defines fixture-control)');
    expect(run.stderr).toContain('compile: failed; nothing was generated');
    expect(await readdir(root)).not.toContain('.features-gen');
  });
});

describe('blackbox feature verify, check and project errors', () => {
  it('verify fails before anything ran, as text and as JSON', async () => {
    await runCommand(FeatureCompile, ['--config', config]);
    const text = await runCommand(FeatureVerify, ['--config', config]);
    expect(text.exit).toBe(1);
    expect(text.stdout).toContain(`error: no run manifest at ${join(root, 'results/blackbox-run.json')}`);
    expect(text.stdout).toContain('verify: failed; 0 of 0 compiled scenarios supported, 2 other problem(s)');
    const json = await runCommand(FeatureVerify, ['--config', config, '--json']);
    expect(json.exit).toBe(1);
    expect(JSON.parse(json.stdout)).toMatchObject({ ok: false, scenarios: [] });
  });

  it('check reports a project step file', async () => {
    await writeFile(join(root, 'features/login.steps.ts'), 'export {};\n');
    const run = await runCommand(FeatureCheck, ['--config', config]);
    expect(run.exit).toBe(1);
    expect(run.stdout).toContain('error: features/login.steps.ts: a project step file');
  });

  it('exits 2 when the project file is missing or invalid', async () => {
    const missing = await runCommand(FeatureVerify, ['--config', join(root, 'nowhere.json')]);
    expect(missing).toMatchObject({ exit: 2 });
    expect(missing.stderr).toContain(`no blackbox.feature.yaml at ${join(root, 'nowhere.json')}`);
    await writeFile(config, stringify({ ...PROJECT, retries: 3 }));
    const invalid = await runCommand(FeatureCompile, ['--config', config]);
    expect(invalid).toMatchObject({ exit: 2 });
    expect(invalid.stderr).toContain('retries: is not a known setting');
  });
});

describe('blackbox feature check-change and steps', () => {
  it('check-change exits 0 for a code-only change and 1 for a mixed one', async () => {
    const repo = await repository();
    await repo.commit('base');
    await git(['checkout', '-q', '-b', 'change'], repo.root);
    await repo.write({ 'app/src/server.ts': 'export const port = 1;\n' });
    await repo.commit('code');
    const argv = ['--config', join(repo.root, 'app/blackbox.feature.yaml'), '--base', 'main'];
    expect(await runCommand(FeatureCheckChange, argv)).toMatchObject({ exit: 0 });
    await repo.write({ 'app/features/intake.feature': 'Feature: weakened\n' });
    await repo.commit('spec');
    const mixed = await runCommand(FeatureCheckChange, argv);
    expect(mixed.exit).toBe(1);
    expect(mixed.stdout).toContain('error: this change mixes spec and code.');
  });

  it('steps lists every library step with an example, and registers all five commands', async () => {
    const run = await runCommand(FeatureSteps, []);
    expect(run.exit).toBe(0);
    expect(run.stdout).toContain('Stimulus (When):\n  the client sends GET {string}\n    When the client sends GET "/health"');
    expect(run.stdout).toContain("parameter 3 names a credential of the feature's Sandbox profile");
    expect(run.stdout).toContain(
      'Effects claims (Then):\n  the effects satisfy:\n    Then the effects satisfy:\n    - needs capability "effects-claims", which this runtime does not offer: it does not compile',
    );
    const json = JSON.parse((await runCommand(FeatureSteps, ['--json'])).stdout) as { steps: unknown[] };
    expect(json.steps).toHaveLength(18);
    expect(Object.keys(COMMANDS).sort()).toEqual([
      'feature:check',
      'feature:check-change',
      'feature:compile',
      'feature:steps',
      'feature:verify',
    ]);
  });
});
