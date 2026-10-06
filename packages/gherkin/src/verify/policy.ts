import { relative } from 'node:path';

import {
  compareWithBaseline,
  type PolicyManifest,
  type RunManifest,
} from '@suites/blackbox-playwright/reporter';

import type { GherkinProject } from '../project/config.js';

// Rule 5: the effective runner policy the reporter recorded must equal the
// protected baseline, compared exactly as the reporter compares it. The policy
// manifest must also describe the same tests as the run manifest, so a policy
// file left over from another run cannot stand in for this one.

const titleOf = (path: readonly string[]): string => path.join(' › ');

function sameTests(policy: PolicyManifest, run: RunManifest): boolean {
  const policyTests = Object.keys(policy.policy.tests).sort();
  const runTests = [...new Set(run.scenarios.map((record) => titleOf(record.titlePath)))].sort();
  return JSON.stringify(policyTests) === JSON.stringify(runTests);
}

/** Policy drift, an unusable baseline, or a policy manifest from another run. */
export function policyProblems(
  project: GherkinProject,
  policy: PolicyManifest,
  run: RunManifest | null,
): readonly string[] {
  const baseline = relative(project.root, project.policy.baseline);
  const comparison = compareWithBaseline(policy, project.policy.baseline, project.root);
  const problems: string[] = [];
  switch (comparison.kind) {
    case 'unconfigured':
    case 'match':
      break;
    case 'invalid':
      problems.push(`the runner-policy baseline ${baseline} is unusable: ${comparison.reason}`);
      break;
    case 'drift':
      problems.push(
        [
          `the runner policy differs from the baseline ${baseline}; change the baseline in a reviewed spec-only change if this is intended:`,
          ...comparison.differences.map((difference) => `  ${difference}`),
        ].join('\n'),
      );
      break;
  }
  if (run !== null && !sameTests(policy, run)) {
    problems.push(
      `the runner-policy manifest ${relative(project.root, project.policy.outputFile)} does not list the tests of the run manifest; both must come from the same run`,
    );
  }
  return problems;
}
