import { rm } from 'node:fs/promises';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { renderVerify } from './render.js';
import { cleanupVerifyProjects, copyOf, readJson, STUB_LIBRARY, verifyProject, writeJson, type VerifyProject } from './testing/project.js';
import { verifyRun } from './verify.js';

// Requirements (task 2.4, report sections 4.4 and 8): verify passes only a run
// in which every compiled scenario ran exactly once and is supported, and
// fails on a missing run manifest, missing or duplicate scenarios, a test that
// was not compiled, any not-supported verdict and requirement IDs that differ
// between the manifests. Requirement IDs never change a verdict. Each failure
// comes from a real Playwright run under defineGherkinConfig, or from one file
// of such a run changed the way a stale or edited file would be.

let passing: VerifyProject;

beforeAll(async () => {
  passing = await verifyProject();
  const run = await passing.run();
  expect(run.code, run.output).toBe(0);
}, 120_000);

afterAll(cleanupVerifyProjects);

const verify = (project: VerifyProject) => verifyRun({ project: project.project, library: STUB_LIBRARY });

const FIRST = { id: 'features/stub.feature:8', feature: 'features/stub.feature', line: 8, title: 'Scenario: the stub answers' };
const SECOND = {
  id: 'features/stub.feature:13',
  feature: 'features/stub.feature',
  line: 13,
  title: 'Rule: a second scenario › Scenario: the stub answers again',
};

/** Changes the run manifest of a copy of the passing project. */
async function withRunManifest(change: (manifest: { scenarios: Record<string, unknown>[] }) => void): Promise<VerifyProject> {
  const copy = await copyOf(passing);
  const manifest = await readJson<{ scenarios: Record<string, unknown>[] }>(copy.project.runManifest);
  change(manifest);
  await writeJson(copy.project.runManifest, manifest);
  return copy;
}

describe('verify passes', () => {
  it('a run of every compiled scenario, once and supported, carrying the requirement IDs', async () => {
    const result = await verify(passing);
    expect(result).toEqual({
      ok: true,
      problems: [],
      scenarios: [
        { ...FIRST, requirements: ['REQ-1', 'REQ-2'], verdict: 'supported', reasons: [] },
        { ...SECOND, requirements: ['REQ-1'], verdict: 'supported', reasons: [] },
      ],
    });
    expect(renderVerify(result).split('\n')).toEqual([
      'supported [REQ-1, REQ-2] features/stub.feature:8 Scenario: the stub answers',
      'supported [REQ-1] features/stub.feature:13 Rule: a second scenario › Scenario: the stub answers again',
      'verify: passed; 2 of 2 compiled scenarios supported, runner policy matches its baseline, features and step library unchanged since compile',
    ]);
  });
});

describe('verify fails on the run', () => {
  it('when the run manifest is missing', async () => {
    const copy = await copyOf(passing);
    await rm(copy.project.runManifest);
    const result = await verify(copy);
    expect(result.ok).toBe(false);
    expect(result.problems).toEqual([
      `no run manifest at ${copy.project.runManifest}: the Blackbox reporter did not write one, so the run had no strict verdicts (was the reporter replaced on the command line?)`,
    ]);
  });

  it('after a rerun without the Blackbox reporter, instead of judging the earlier run (benchmark F1, stale-L2)', {
    timeout: 60_000,
  }, async () => {
    const copy = await copyOf(passing);
    expect((await verify(copy)).ok).toBe(true);
    // The system now fails, and the rerun replaces the reporter and the timeout on the command line.
    const rerun = await copy.run(['--reporter=list', '--timeout=5000'], { BLACKBOX_STUB_STATUS: '503' });
    expect(rerun.code, rerun.output).toBe(1);
    expect(rerun.output).toContain('stub response status is 503, not 200');
    const result = await verify(copy);
    expect(result.ok).toBe(false);
    expect(result.problems).toEqual([
      `no run manifest at ${copy.project.runManifest}: the Blackbox reporter did not write one, so the run had no strict verdicts (was the reporter replaced on the command line?)`,
      `no runner-policy manifest at ${copy.project.policy.outputFile}: the Blackbox reporter did not record the effective runner policy`,
    ]);
  });

  it('when a compiled scenario did not run', { timeout: 60_000 }, async () => {
    const copy = await copyOf(passing);
    const run = await copy.run(['--grep', 'again']);
    expect(run.code, run.output).toBe(1);
    const result = await verify(copy);
    expect(result.ok).toBe(false);
    expect(result.scenarios.map((scenario) => [scenario.id, scenario.verdict])).toEqual([
      [FIRST.id, 'not-run'],
      [SECOND.id, 'supported'],
    ]);
    expect(renderVerify(result)).toContain('not run (did not run) [REQ-1, REQ-2] features/stub.feature:8 Scenario: the stub answers');
  });

  it('when a scenario ran twice', async () => {
    const copy = await withRunManifest((manifest) => manifest.scenarios.push({ ...manifest.scenarios[0], id: 'repeat' }));
    const result = await verify(copy);
    expect(result.ok).toBe(false);
    expect(result.scenarios[0]).toMatchObject({ verdict: 'duplicate', reasons: ['ran 2 times; a scenario must run exactly once'] });
  });

  it('when a test ran that no accepted feature compiled to', async () => {
    const copy = await withRunManifest((manifest) =>
      manifest.scenarios.push({ ...manifest.scenarios[0], titlePath: ['features/stub.feature.spec.mjs', 'hand-written test'] }),
    );
    expect((await verify(copy)).problems).toEqual([
      'test "features/stub.feature.spec.mjs › hand-written test" ran but was not compiled from an accepted feature',
      expect.stringContaining('does not list the tests of the run manifest'),
    ]);
  });
});

describe('verify fails on verdicts and requirement IDs', () => {
  it('when a scenario is not supported, and reports the run status', { timeout: 120_000 }, async () => {
    const failing = await verifyProject(500);
    const run = await failing.run();
    expect(run.code, run.output).toBe(1);
    const result = await verify(failing);
    expect(result.ok).toBe(false);
    expect(result.scenarios.map((scenario) => [scenario.id, scenario.verdict, scenario.reasons])).toEqual([
      [FIRST.id, 'not-supported', ['failed']],
      [SECOND.id, 'supported', []],
    ]);
    expect(result.problems).toEqual(['the run status is "failed", not "passed"']);
    expect(renderVerify(result)).toContain('not supported (failed) [REQ-1, REQ-2] features/stub.feature:8 Scenario: the stub answers');
  });

  it('when requirement IDs differ between the manifests, without changing the verdict', async () => {
    const copy = await withRunManifest((manifest) => {
      manifest.scenarios[0].requirements = ['REQ-1'];
    });
    const result = await verify(copy);
    expect(result.ok).toBe(false);
    expect(result.scenarios[0]).toMatchObject({ verdict: 'supported', requirements: ['REQ-1', 'REQ-2'] });
    expect(result.problems).toEqual([
      'requirement IDs of features/stub.feature:8 differ between the compile manifest [REQ-1, REQ-2] and the run manifest [REQ-1]',
    ]);
  });
});
