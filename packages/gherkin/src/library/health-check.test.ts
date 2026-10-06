import { copyFile, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { compileFeatures } from '../compiler/compile.js';
import { testCatalog } from '../compiler/testing/context.js';
import { library } from './index.js';
import { useStubSystems } from './testing/stub-lifecycle.js';
import { featureFixture, verdicts } from './testing/worked-examples.js';

// Requirement (task 2.3, captain's addition on #154): the showcase's feature 1,
// the health check, compiles against the shared library now that it has a
// bodyless GET stimulus, and runs: supported when the stub is ready, not
// supported at the status claim when the stub answers 503 "starting" (the
// stated wrong case). Before the GET step it failed to compile with
// `undefined step "When the client sends GET "/health""`.

const system = useStubSystems(beforeAll, afterEach);
const FEATURE = featureFixture('health-check.feature');
const SCENARIO = 'Scenario: the public API reports ready';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('worked example: health check', () => {
  it('compiles to one generated test that runs the GET stimulus at its .feature line', async () => {
    const root = await mkdtemp(join(tmpdir(), 'blackbox-gherkin-health-'));
    roots.push(root);
    await mkdir(join(root, 'features'));
    await copyFile(fileURLToPath(FEATURE), join(root, 'features', '01-health-check.feature'));
    const { manifest, files } = await compileFeatures({
      rootDir: root,
      outputDir: join(root, '.features-gen'),
      features: ['features/01-health-check.feature'],
      context: { catalog: testCatalog, sandboxProfiles: { default: { environment: {} } }, library },
      runtimeModule: '@suites/blackbox-gherkin',
    });
    expect(files).toEqual(['features/01-health-check.feature.spec.mjs']);
    expect(manifest.scenarios.map((scenario) => [scenario.titlePath.at(-1), scenario.line, scenario.requirements])).toEqual([
      [SCENARIO, 6, ['REQ-1']],
    ]);
    const generated = await readFile(join(root, '.features-gen', files[0]), 'utf8');
    expect(generated).toContain(
      'await runStep(fixtures, { feature, line: 7, column: 5, keyword: "When" }, "the client sends GET \\"/health\\"", {"kind":"none"});',
    );
  });

  it('is supported by a ready system and not supported by one that is still starting', async () => {
    expect(await verdicts(FEATURE, system, 'correct')).toEqual({ [SCENARIO]: 'supported' });
    expect(await verdicts(FEATURE, system, 'not-ready')).toEqual({
      [SCENARIO]: 'not supported at line 8: Then the response status is 200',
    });
  });
});
