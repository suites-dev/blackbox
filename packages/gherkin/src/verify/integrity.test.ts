import { appendFile, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { MANIFEST_FILE } from '../compiler/manifest.js';
import { library as sharedLibrary } from '../library/index.js';
import { compilerTestLibrary } from '../library/testing/compiler-steps.js';
import type { StepLibrary } from '../runtime/library.js';
import { cleanupVerifyProjects, copyOf, feature, readJson, readYaml, STUB_LIBRARY, verifyProject, writeJson, writeYaml, type VerifyProject } from './testing/project.js';
import { verifyRun } from './verify.js';

// Requirements (task 2.4, report sections 4.3, 4.5 and 8): verify fails on
// runner-policy drift against the protected baseline, on a policy manifest
// that is missing or from another run, and when the features, the generated
// tests or the step library differ from what the compile manifest recorded.

let passing: VerifyProject;

beforeAll(async () => {
  passing = await verifyProject();
  const run = await passing.run();
  expect(run.code, run.output).toBe(0);
}, 120_000);

afterAll(cleanupVerifyProjects);

const verify = (project: VerifyProject, library: StepLibrary = STUB_LIBRARY) =>
  verifyRun({ project: project.project, library });

describe('verify fails on runner policy', () => {
  it('when retries on the command line differ from the baseline', { timeout: 60_000 }, async () => {
    const copy = await copyOf(passing);
    const run = await copy.run(['--retries=1']);
    expect(run.code, run.output).toBe(1);
    const result = await verify(copy);
    expect(result.ok).toBe(false);
    expect(result.problems).toContainEqual(
      expect.stringMatching(/^the runner policy differs from the baseline blackbox\.policy\.yaml; .*\n {2}policy\.projects\[""\]\.retries: not in baseline, effective 1$/mu),
    );
  });

  it('when the baseline no longer matches the run, naming each difference', async () => {
    const copy = await copyOf(passing);
    const baseline = await readYaml<{ policy: Record<string, unknown> }>(copy.project.policy.baseline);
    baseline.policy.workers = 4;
    await writeYaml(copy.project.policy.baseline, baseline);
    expect((await verify(copy)).problems).toEqual([
      'the runner policy differs from the baseline blackbox.policy.yaml; change the baseline in a reviewed spec-only change if this is intended:\n  policy.workers: baseline 4, effective 1',
    ]);
  });

  it('when the runner-policy manifest is missing', async () => {
    const missing = await copyOf(passing);
    await rm(missing.project.policy.outputFile);
    expect((await verify(missing)).problems).toEqual([
      `no runner-policy manifest at ${missing.project.policy.outputFile}: the Blackbox reporter did not record the effective runner policy`,
    ]);
  });
});

describe('verify fails when the compiled output is not what ran', () => {
  it('when a feature changed after compile', async () => {
    const copy = await copyOf(passing);
    await writeFile(join(copy.root, 'features/stub.feature'), feature(201));
    const result = await verify(copy);
    expect(result.ok).toBe(false);
    expect(result.problems).toEqual([expect.stringMatching(/^feature features\/stub\.feature differs from the compiled one \(compiled sha256:\w+, now sha256:\w+\)$/u)]);
  });

  it('when a generated test was edited after compile', async () => {
    const copy = await copyOf(passing);
    await appendFile(join(copy.project.outputDir, 'features/stub.feature.spec.mjs'), '// edited\n');
    expect((await verify(copy)).problems).toEqual([
      expect.stringMatching(/^generated test features\/stub\.feature\.spec\.mjs differs from what compile wrote/u),
    ]);
  });

  it('when the installed step library or its capabilities differ from the compiled ones', async () => {
    const other = await verify(passing, sharedLibrary);
    expect(other.ok).toBe(false);
    expect(other.problems).toEqual([
      expect.stringMatching(/^the step library differs from the one the features were compiled against \(compiled compiler-test-library@0\.0\.0 sha256:\w+, installed @suites\/blackbox-gherkin@/u),
    ]);
    // Same name and version, another vocabulary: only the vocabulary hash tells them apart.
    const recompiled = await copyOf(passing);
    const manifestFile = join(recompiled.project.outputDir, MANIFEST_FILE);
    const manifest = await readJson<{ library: { vocabularyHash: string } }>(manifestFile);
    manifest.library.vocabularyHash = `sha256:${'0'.repeat(64)}`;
    await writeJson(manifestFile, manifest);
    expect((await verify(recompiled)).problems).toEqual([
      expect.stringMatching(/^the step library differs .*\(compiled compiler-test-library@0\.0\.0 sha256:0{64}, installed compiler-test-library@0\.0\.0 sha256:/u),
    ]);
    // Same name, version and vocabulary, one step body replaced: the hash covers bodies.
    const rebodied = compilerTestLibrary([], { 'the response status is {int}': () => Promise.reject(new Error('replaced')) });
    expect((await verify(passing, rebodied)).problems).toEqual([
      expect.stringMatching(/^the step library differs .*\(compiled compiler-test-library@0\.0\.0 sha256:\w+, installed compiler-test-library@0\.0\.0 sha256:/u),
    ]);
    const gated = await verify(passing, compilerTestLibrary(['effects-claims']));
    expect(gated.problems).toEqual(['runtime capabilities differ from the compiled ones (compiled [], installed [effects-claims])']);
  });

  it('when a feature was added or the compile manifest is gone', async () => {
    const added = await copyOf(passing);
    await writeFile(join(added.root, 'features/new.feature'), await readFile(join(added.root, 'features/stub.feature'), 'utf8'));
    expect((await verify(added)).problems).toEqual(['feature features/new.feature is not in the compile manifest; recompile']);
    const uncompiled = await copyOf(passing);
    await rm(join(uncompiled.project.outputDir, MANIFEST_FILE));
    const result = await verify(uncompiled);
    expect(result).toMatchObject({ ok: false, scenarios: [] });
    expect(result.problems).toEqual([
      `no compile manifest at ${join(uncompiled.project.outputDir, MANIFEST_FILE)}: run \`blackbox feature compile\` first`,
    ]);
  });
});
