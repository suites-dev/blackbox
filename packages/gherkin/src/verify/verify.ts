import { resolve } from 'node:path';

import { MANIFEST_FILE } from '../compiler/manifest.js';
import type { GherkinProject } from '../project/config.js';
import type { StepLibrary } from '../runtime/library.js';
import { integrityProblems } from './integrity.js';
import { joinRun, type ScenarioOutcome } from './join.js';
import { readCompileManifest, readPolicyManifest, readRunManifest } from './manifests.js';
import { policyProblems } from './policy.js';

export type { ScenarioOutcome } from './join.js';

export interface VerifyInput {
  readonly project: GherkinProject;
  /** The installed step library the compile manifest must name. */
  readonly library: StepLibrary;
}

export interface VerifyResult {
  /** True only when every compiled scenario ran once, supported, and nothing else is wrong. */
  readonly ok: boolean;
  readonly scenarios: readonly ScenarioOutcome[];
  readonly problems: readonly string[];
}

/**
 * Verifies a finished run from its files (hard rules 4 and 5): the compile
 * manifest, the run manifest and the effective runner policy. It fails on a
 * missing manifest, a compiled scenario that did not run, ran twice or is not
 * supported, a test that was not compiled, requirement IDs that differ between
 * the manifests, runner-policy drift, and features, generated tests or a step
 * library that differ from what was compiled. It computes no requirement
 * coverage: requirement IDs are carried and compared, never counted.
 */
export async function verifyRun(input: VerifyInput): Promise<VerifyResult> {
  const { project, library } = input;
  const problems: string[] = [];
  const compiled = await readCompileManifest(resolve(project.outputDir, MANIFEST_FILE));
  const run = await readRunManifest(project.runManifest);
  const policy = await readPolicyManifest(project.policy.outputFile);
  let scenarios: readonly ScenarioOutcome[] = [];
  if (compiled.kind === 'problem') {
    problems.push(compiled.problem);
  } else {
    problems.push(...(await integrityProblems(project, compiled.value, library)));
    if (run.kind === 'read') {
      const joined = joinRun(compiled.value, run.value);
      scenarios = joined.scenarios;
      problems.push(...joined.problems);
    }
  }
  if (run.kind === 'problem') {
    problems.push(run.problem);
  }
  if (policy.kind === 'problem') {
    problems.push(policy.problem);
  } else {
    problems.push(...policyProblems(project, policy.value));
  }
  const supported = scenarios.length > 0 && scenarios.every((scenario) => scenario.verdict === 'supported');
  return { ok: supported && problems.length === 0, scenarios, problems };
}
