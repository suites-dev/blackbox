import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { compileFeatures } from './compile.js';
import type { CompileManifest } from './manifest.js';
import { testContext } from './testing/context.js';
import { cleanupProjects, FIXTURE_FEATURES, fixtureProject, type FixtureProject } from './testing/project.js';
import { writeRecordingRuntime, type RecordedTest } from './testing/recording.js';

// Requirements (task 2.2): generated files declare the feature through the
// public test.system(...).sandbox(...) facade, Backgrounds run inside each
// test before its own steps (feature level first), every step reports its
// .feature location, requirement IDs in the annotations equal the compile
// manifest, and adding or removing requirement tags changes nothing else.

afterEach(cleanupProjects);

interface Executed {
  readonly project: FixtureProject;
  readonly manifest: CompileManifest;
  readonly tests: readonly RecordedTest[];
}

async function compileAndRun(project: FixtureProject): Promise<Executed> {
  const runtime = await writeRecordingRuntime(project.root);
  const { manifest, files } = await compileFeatures({
    rootDir: project.root,
    outputDir: project.outputDir,
    features: project.features,
    context: testContext(),
    runtimeModule: runtime.module,
  });
  const tests: RecordedTest[] = [];
  for (const file of files) {
    tests.push(...(await runtime.run(join(project.outputDir, file))));
  }
  return { project, manifest, tests };
}

function titled(tests: readonly RecordedTest[], title: string): RecordedTest {
  const test = tests.find((candidate) => candidate.titlePath.at(-1) === title);
  if (test === undefined) {
    throw new Error(`no generated test titled ${title}`);
  }
  return test;
}

const requirementsOf = (test: RecordedTest): unknown =>
  (test.annotation as readonly { readonly type: string; readonly description: string }[]).map((annotation) => {
    expect(annotation.type).toBe('requirement');
    return annotation.description;
  });

describe('executing the generated code', () => {
  it('declares every manifest scenario once, with the manifest selection and requirement IDs as annotations', async () => {
    const { manifest, tests } = await compileAndRun(await fixtureProject());
    expect(tests.map((test) => test.titlePath)).toEqual(manifest.scenarios.map((scenario) => scenario.titlePath));
    for (const [index, scenario] of manifest.scenarios.entries()) {
      const test = tests[index];
      expect(test.selection).toEqual({ kind: scenario.selection.kind, id: scenario.selection.id });
      expect(test.sandbox).toBe(scenario.selection.sandbox);
      expect(requirementsOf(test)).toEqual(scenario.requirements);
    }
    expect(new Set(tests.map((test) => JSON.stringify(test.selection)))).toEqual(
      new Set(['{"kind":"system","id":"subscription-system"}', '{"kind":"subsystem","id":"payment-mock"}']),
    );
  });

  it('runs feature and Rule Backgrounds before the scenario steps, each at its .feature location', async () => {
    const { project, tests } = await compileAndRun(await fixtureProject());
    const feature = join(project.root, 'features/rules.feature');
    const test = titled(tests, 'Scenario: an eligible user subscribes');
    expect(test.steps.map(({ feature: file, line, column, keyword, text }) => ({ file, line, column, keyword, text }))).toEqual([
      { file: feature, line: 5, column: 5, keyword: 'Given', text: 'the account "carol" exists' },
      { file: feature, line: 15, column: 7, keyword: 'Given', text: 'the account "alice" exists' },
      { file: feature, line: 19, column: 7, keyword: 'When', text: 'the client sends POST "/subscriptions" with JSON:' },
      { file: feature, line: 23, column: 7, keyword: 'Then', text: 'the flow is sealed by the terminal response' },
      { file: feature, line: 24, column: 7, keyword: 'And', text: 'the response status is 201' },
    ]);
    expect(titled(tests, 'Scenario: outside any Rule').steps.map((step) => step.line)).toEqual([5, 8, 9]);
  });

  it('passes outline values, doc strings and data tables, and destructures only the fixtures steps declare', async () => {
    const { tests } = await compileAndRun(await fixtureProject());
    const eve = titled(tests, 'Scenario: eve is rejected [user=eve, method=pm_eve, status=403]');
    expect(eve.steps.map((step) => [step.text, step.argument])).toEqual([
      [
        'the client sends POST "/subscriptions" with JSON:',
        { kind: 'doc-string', content: '{"userId": "eve", "paymentMethodId": "pm_eve"}', mediaType: 'json' },
      ],
      ['the response status is 403', { kind: 'none' }],
    ]);
    expect(eve.steps.map((step) => step.fixtures)).toEqual([
      ['request', 'sandbox', 'world'],
      ['request', 'sandbox', 'world'],
    ]);
    const concurrent = titled(tests, 'Scenario: concurrent requests');
    expect(concurrent.steps[0].argument).toEqual({
      kind: 'data-table',
      rows: [
        ['method', 'path', 'json'],
        ['POST', '/subscriptions', '{"userId": "bob"}'],
        ['POST', '/subscriptions', '{"userId": "bob"}'],
      ],
    });
    expect(concurrent.environment).toEqual({
      spec: { FIXTURE_CONTROL_TOKEN: { fromEnv: 'BLACKBOX_E2E_FIXTURE_TOKEN' } },
    });
  });

  it('declares and runs the same tests when every requirement tag is removed', async () => {
    const tagged = await compileAndRun(await fixtureProject());
    const untaggedProject = await fixtureProject();
    for (const name of FIXTURE_FEATURES) {
      const file = join(untaggedProject.root, `features/${name}.feature`);
      const source = await readFile(file, 'utf8');
      // Removing a tag line keeps line numbers by leaving the line empty.
      await writeFile(file, source.replaceAll(/ ?@requirement:REQ-\d+/gu, ''));
    }
    const untagged = await compileAndRun(untaggedProject);
    expect(tagged.tests.filter((test) => (test.annotation as unknown[]).length > 0)).not.toHaveLength(0);
    const neutral = (executed: Executed) => ({
      tests: executed.tests.map((test) => ({
        ...test,
        annotation: undefined,
        steps: test.steps.map((step) => ({ ...step, feature: step.feature.slice(executed.project.root.length) })),
      })),
      scenarios: executed.manifest.scenarios.map((scenario) => ({ ...scenario, requirements: undefined })),
    });
    expect(untagged.tests.every((test) => (test.annotation as unknown[]).length === 0)).toBe(true);
    expect(untagged.manifest.scenarios.every((scenario) => scenario.requirements.length === 0)).toBe(true);
    expect(neutral(untagged)).toEqual(neutral(tagged));
  });
});
