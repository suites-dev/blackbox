import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { compileFeatures } from './compile.js';
import { sha256 } from './manifest.js';
import { testContext } from './testing/context.js';
import { cleanupProjects, FIXTURE_FEATURES, fixtureProject, golden } from './testing/project.js';

// Requirement (task 2.2): golden-file tests per construct. Each fixture
// feature exercises one construct: feature-level Background, Rules with
// Rule-level Backgrounds and requirement IDs at three levels, Scenario Outline
// rows, doc strings and data tables, and a catalog-resolved subsystem kind.

afterEach(cleanupProjects);

async function compileFixtures() {
  const project = await fixtureProject();
  const output = await compileFeatures({
    rootDir: project.root,
    outputDir: project.outputDir,
    features: project.features,
    context: testContext(),
    runtimeModule: '@suites/blackbox-gherkin',
  });
  return { project, output };
}

describe('generated code matches the golden files', () => {
  it.each(FIXTURE_FEATURES)('%s.feature', async (name) => {
    const { project } = await compileFixtures();
    const generated = await readFile(join(project.outputDir, `features/${name}.feature.spec.mjs`), 'utf8');
    expect(generated).toBe(await golden(`${name}.feature.spec.mjs`, generated));
  });

  it('compile-manifest.json', async () => {
    const { project, output } = await compileFixtures();
    const written = await readFile(join(project.outputDir, 'compile-manifest.json'), 'utf8');
    expect(JSON.parse(written)).toEqual(output.manifest);
    expect(written).toBe(await golden('compile-manifest.json', written));
  });
});

describe('the compile manifest', () => {
  it('records one scenario per generated test with the union of requirement IDs', async () => {
    const { output } = await compileFixtures();
    const byTitle = new Map(output.manifest.scenarios.map((scenario) => [scenario.titlePath.at(-1), scenario]));
    expect(byTitle.get('Scenario: an eligible user subscribes')).toMatchObject({
      id: 'features/rules.feature:18',
      feature: 'features/rules.feature',
      line: 18,
      exampleLine: null,
      titlePath: ['Feature: Rules and Rule-level Backgrounds', 'Rule: full-path subscriptions', 'Scenario: an eligible user subscribes'],
      selection: { kind: 'system', id: 'subscription-system', sandbox: 'default' },
      requirements: ['REQ-100', 'REQ-101', 'REQ-110'],
    });
    expect(byTitle.get('Scenario: an unknown user is rejected')).toMatchObject({ requirements: ['REQ-100'] });
    expect(byTitle.get('Scenario: eve is rejected [user=eve, method=pm_eve, status=403]')).toMatchObject({
      id: 'features/outline.feature:5:19',
      exampleLine: 19,
      requirements: ['REQ-102'],
    });
    expect(output.manifest.scenarios).toHaveLength(12);
    expect(output.files).toEqual(FIXTURE_FEATURES.map((name) => `features/${name}.feature.spec.mjs`));
  });

  it('records the step library identity, the offered capabilities and per-feature hashes', async () => {
    const { project, output } = await compileFixtures();
    const { library } = testContext();
    expect(output.manifest.library).toEqual(library.identity);
    expect(output.manifest.capabilities).toEqual([]);
    const subsystem = output.manifest.features.find((feature) => feature.feature === 'features/subsystem.feature');
    expect(subsystem).toMatchObject({
      selection: { kind: 'subsystem', id: 'payment-mock', sandbox: 'bare' },
      generated: 'features/subsystem.feature.spec.mjs',
    });
    const source = await readFile(join(project.root, 'features/subsystem.feature'), 'utf8');
    expect(subsystem!.featureHash).toBe(sha256(source));
  });
});

describe('barrier deadlines in the compile manifest', () => {
  it('records every deadline a scenario runs, feature and Rule Background barriers first', async () => {
    const { output } = await compileFixtures();
    const deadlines = (title: string) =>
      output.manifest.scenarios.filter((scenario) => scenario.titlePath.at(-1) === title).map((scenario) => scenario.barrierDeadlines)[0];
    expect(deadlines('Scenario: a scenario deadline after the Background one')).toEqual([
      { line: 7, column: 5, seconds: 3 },
      { line: 11, column: 5, seconds: 10 },
    ]);
    expect(deadlines('Scenario: a Rule scenario runs both Background deadlines')).toEqual([
      { line: 7, column: 5, seconds: 3 },
      { line: 17, column: 7, seconds: 1 },
    ]);
    // A synchronous seal has no deadline.
    expect(deadlines('Scenario: an eligible user subscribes')).toEqual([]);
  });
});
