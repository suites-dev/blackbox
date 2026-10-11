import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Config } from '@oclif/core';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FeatureFileValidate, FeatureSuiteEmit } from '../src/cli/feature-commands.js';
import { compileFeature } from '../src/index.js';
import { catalog, catalogYaml } from './fixtures/catalog.js';

const clients = { api: { from: '../clients.js', export: 'api' } } as const;

/** An empty oclif root, so running a command class does not load this package's built registry. */
let oclifRoot = '';
beforeAll(async () => {
  oclifRoot = await mkdtemp(path.join(tmpdir(), 'feature-catalog-oclif-'));
  await writeFile(path.join(oclifRoot, 'package.json'), JSON.stringify({ name: 'feature-catalog-test', version: '0.0.0', oclif: {} }));
});

afterAll(async () => {
  await rm(oclifRoot, { recursive: true, force: true });
});

function feature(tags: string): string {
  return `${tags}
Feature: Health
  Scenario: the API answers
    When client "api" sends GET "/health"
    Then the response status is 200
`;
}

describe('Feature system tags are checked against the catalog', () => {
  it('compiles a tag that names a catalog entry of the same kind', () => {
    const subsystem = compileFeature({ catalog, clients, source: feature('@subsystem:orders @sandbox:default') });
    expect(subsystem.diagnostics).toEqual([]);
    expect(subsystem.code).toContain(`test.system({ kind: 'subsystem', id: "orders" }`);
    const system = compileFeature({ catalog, clients, source: feature('@system:subscription-system') });
    expect(system.diagnostics).toEqual([]);
    expect(system.code).toContain(`test.system({ kind: 'system', id: "subscription-system" }`);
  });

  it('rejects an unknown id at the tag and lists the catalog ids', () => {
    const result = compileFeature({ catalog, clients, source: feature('@sync @subsystem:nope @sandbox:default') });
    expect(result.code).toBe('');
    expect(result.diagnostics).toEqual([{
      code: 'FEATURE_SYSTEM_UNKNOWN',
      message: 'Unknown subsystem "nope": blackbox.config.yaml has no such entry. Catalog entries: escape-tests (subsystem), orders (subsystem), subscription-system (system).',
      line: 1,
      column: 7,
    }]);
  });

  it('rejects a tag whose kind differs from the catalog entry', () => {
    const system = compileFeature({ catalog, clients, source: feature('@system:orders') });
    expect(system.diagnostics).toEqual([{
      code: 'FEATURE_SYSTEM_KIND',
      message: '"orders" is a subsystem in blackbox.config.yaml; tag it @subsystem:orders.',
      line: 1,
      column: 1,
    }]);
    const subsystem = compileFeature({ catalog, clients, source: feature('@subsystem:subscription-system') });
    expect(subsystem.diagnostics.map(({ code, message }) => ({ code, message }))).toEqual([{
      code: 'FEATURE_SYSTEM_KIND',
      message: '"subscription-system" is a system in blackbox.config.yaml; tag it @system:subscription-system.',
    }]);
  });

  it('rejects a Feature without a system tag instead of using its title', () => {
    const result = compileFeature({ catalog, clients, source: feature('@sandbox:default').replace('Health', 'orders') });
    expect(result.code).toBe('');
    expect(result.diagnostics).toEqual([{
      code: 'FEATURE_SYSTEM_MISSING',
      message: 'Feature needs a @system:<id> or @subsystem:<id> tag naming an entry in blackbox.config.yaml.',
      line: 2,
      column: 1,
    }]);
  });

  it('rejects a Feature that names two systems', () => {
    const result = compileFeature({ catalog, clients, source: feature('@subsystem:orders @system:subscription-system') });
    expect(result.diagnostics).toEqual([{
      code: 'FEATURE_SYSTEM_DUPLICATE',
      message: 'Feature names more than one system: @subsystem:orders, @system:subscription-system.',
      line: 1,
      column: 19,
    }]);
  });
});

describe('feature file validate and feature suite emit load blackbox.config.yaml', () => {
  let directory: string;
  let featureFile: string;
  let clientsFile: string;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'feature-catalog-'));
    await mkdir(path.join(directory, 'features', 'nested'), { recursive: true });
    featureFile = path.join(directory, 'features', 'nested', 'health.feature');
    clientsFile = path.join(directory, 'features', 'clients.ts');
    await writeFile(clientsFile, 'export const api = {};\n');
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  async function validate(...flags: string[]): Promise<void> {
    await FeatureFileValidate.run([featureFile, '--clients', clientsFile, ...flags], await Config.load({ root: oclifRoot }));
  }

  async function emit(...flags: string[]): Promise<void> {
    const output = path.join(directory, 'features', 'health.spec.ts');
    await FeatureSuiteEmit.run([featureFile, '--clients', clientsFile, '--output', output, ...flags], await Config.load({ root: oclifRoot }));
  }

  async function writtenSuites(): Promise<string[]> {
    return (await readdir(path.join(directory, 'features'))).filter((name) => name.endsWith('.spec.ts'));
  }

  it('finds the nearest catalog above the Feature and accepts a known subsystem', async () => {
    await writeFile(path.join(directory, 'blackbox.config.yaml'), catalogYaml([{ id: 'pokeshop', kind: 'subsystem' }]));
    await writeFile(featureFile, feature('@subsystem:pokeshop'));
    await expect(validate()).resolves.toBeUndefined();
    await expect(emit()).resolves.toBeUndefined();
    expect(await writtenSuites()).toEqual(['health.spec.ts']);
  });

  it('refuses an unknown id in both commands with exit 2 and writes no suite', async () => {
    await writeFile(path.join(directory, 'blackbox.config.yaml'), catalogYaml([{ id: 'pokeshop', kind: 'subsystem' }]));
    await writeFile(featureFile, feature('@subsystem:nope @sandbox:default'));
    const refusal = {
      oclif: { exit: 2 },
      message: expect.stringMatching(/^FEATURE_SYSTEM_UNKNOWN \(1:1\): Unknown subsystem "nope": .*Catalog entries: pokeshop \(subsystem\)\.$/u),
    };
    await expect(validate()).rejects.toMatchObject(refusal);
    await expect(emit()).rejects.toMatchObject(refusal);
    expect(await writtenSuites()).toEqual([]);
  });

  it('refuses a wrong kind and a missing tag in both commands', async () => {
    await writeFile(path.join(directory, 'blackbox.config.yaml'), catalogYaml([{ id: 'pokeshop', kind: 'subsystem' }]));
    for (const [tags, code] of [['@system:pokeshop', 'FEATURE_SYSTEM_KIND'], ['@sandbox:default', 'FEATURE_SYSTEM_MISSING']] as const) {
      await writeFile(featureFile, feature(tags));
      await expect(validate()).rejects.toMatchObject({ oclif: { exit: 2 }, message: expect.stringContaining(code) });
      await expect(emit()).rejects.toMatchObject({ oclif: { exit: 2 }, message: expect.stringContaining(code) });
    }
    expect(await writtenSuites()).toEqual([]);
  });

  it('reports a missing catalog clearly in both commands', async () => {
    await writeFile(featureFile, feature('@subsystem:pokeshop'));
    const missing = {
      oclif: { exit: 2 },
      message: `FEATURE_CATALOG_MISSING (1:1): No blackbox.config.yaml found in ${path.dirname(featureFile)} or any parent directory; pass --config <path>.`,
    };
    await expect(validate()).rejects.toMatchObject(missing);
    await expect(emit()).rejects.toMatchObject(missing);
    const explicit = path.join(directory, 'missing.yaml');
    await expect(validate('--config', explicit)).rejects.toMatchObject({
      oclif: { exit: 2 },
      message: expect.stringMatching(/^FEATURE_CATALOG_MISSING \(1:1\): Catalog file does not exist: .*missing\.yaml\.$/u),
    });
    expect(await writtenSuites()).toEqual([]);
  });

  it('uses --config instead of the nearest catalog', async () => {
    await writeFile(path.join(directory, 'blackbox.config.yaml'), catalogYaml([{ id: 'pokeshop', kind: 'subsystem' }]));
    const other = path.join(directory, 'other.yaml');
    await writeFile(other, catalogYaml([{ id: 'checkout', kind: 'system' }]));
    await writeFile(featureFile, feature('@system:checkout'));
    await expect(validate()).rejects.toMatchObject({ message: expect.stringContaining('FEATURE_SYSTEM_UNKNOWN') });
    await expect(validate('--config', other)).resolves.toBeUndefined();
  });

  it('reports a catalog the catalog package rejects', async () => {
    await writeFile(path.join(directory, 'blackbox.config.yaml'), 'schemaVersion: 2\n');
    await writeFile(featureFile, feature('@subsystem:pokeshop'));
    await expect(validate()).rejects.toMatchObject({ oclif: { exit: 2 }, message: expect.stringContaining('FEATURE_CATALOG_INVALID (1:1)') });
  });
});
