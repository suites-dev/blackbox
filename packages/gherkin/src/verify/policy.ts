import { relative } from 'node:path';

import { compareWithBaseline, type PolicyManifest } from '@suites/blackbox-playwright/reporter';

import type { GherkinProject } from '../project/config.js';

// Rule 5: the effective runner policy the reporter recorded must equal the
// protected baseline, compared exactly as the reporter compares it. The policy
// lists only settings that can change a verdict, not every test, so it cannot
// prove which run wrote it; defineGherkinConfig's global setup deletes it with
// the run manifest before every run, so a file left over from another run
// cannot stand in for this one.

/** Policy drift or an unusable baseline. */
export function policyProblems(project: GherkinProject, policy: PolicyManifest): readonly string[] {
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
  return problems;
}
