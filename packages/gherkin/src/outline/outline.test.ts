import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { InvalidFeatureError } from '../feature/diagnostics.js';
import { parseGherkinProject } from '../project/config.js';
import { projectFiles } from '../project/files.js';
import { testSentences } from '../validation/testing/context.js';
import { outline, outlineFeature } from './outline.js';

// Requirements: the outline is plain data per feature (file, title, tags,
// rules, backgrounds, scenarios with title, tags and ordered steps with
// keyword, text and values), with each Scenario Outline expanded per Examples
// row and every position a `.feature` line. It carries no Playwright types.

const FIXTURE = new URL('test-fixtures/subscriptions.feature', import.meta.url);

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('outlineFeature', () => {
  it('describes a feature with Rules, Backgrounds and an Outline as plain data', async () => {
    const result = outlineFeature(
      await readFile(FIXTURE, 'utf8'),
      'features/subscriptions.feature',
      testSentences(),
    );
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
    await expect(`${JSON.stringify(result, null, 2)}\n`).toMatchFileSnapshot(
      'test-fixtures/subscriptions.outline.json',
    );
  });

  it('throws for a feature that does not parse, naming file:line:column', () => {
    const read = () =>
      outlineFeature(
        'Feature: x\n  Scenario: y\n    When z\n    Not a step\n',
        'features/x.feature',
        testSentences(),
      );
    expect(read).toThrow(InvalidFeatureError);
    expect(read).toThrow(/^features\/x\.feature:4:5: expected: /u);
  });
});

describe('outline', () => {
  it('describes every accepted feature of a project in path order and writes nothing', async () => {
    const root = await mkdtemp(join(tmpdir(), 'blackbox-gherkin-outline-'));
    roots.push(root);
    await mkdir(join(root, 'features/b'), { recursive: true });
    await writeFile(join(root, 'features/b/two.feature'), 'Feature: two\n');
    await writeFile(join(root, 'features/one.feature'), 'Feature: one\n');
    await writeFile(join(root, 'notes.feature'), 'Feature: not accepted\n');
    const project = parseGherkinProject(
      {
        schemaVersion: 1,
        blackboxConfigFile: 'blackbox.config.yaml',
        features: ['features/**/*.feature'],
        sandboxes: { default: {} },
      },
      join(root, 'blackbox.feature.yaml'),
    );
    const before = await projectFiles(root);
    const outlines = await outline(project, testSentences());
    expect(await projectFiles(root)).toEqual(before);
    expect(outlines.map((feature) => [feature.file, feature.title])).toEqual([
      ['features/b/two.feature', 'two'],
      ['features/one.feature', 'one'],
    ]);
  });
});
