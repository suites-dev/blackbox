import type { FeatureOutline, SuiteOutline } from '../outline.js';
import type { Sentence } from '../sentences.js';
import { editFix, emitFix, type DriftFinding } from './findings.js';
import { stepDrift } from './steps.js';

// Drift between a feature and its committed suite, in both directions.
// Scenarios pair with tests by exact title: a renamed scenario is one scenario
// missing from the suite plus one test with no scenario, never inferred to be
// the same one. TODO and written step bodies are the suite's own business and
// never drift; their step lines still do.

/**
 * Compares a feature outline with the outline of its suite file. Findings are
 * in feature order, then the suite's extra tests; an empty list means no drift.
 */
export function findDrift(
  feature: FeatureOutline,
  suite: SuiteOutline,
  sentences: readonly Sentence[],
): readonly DriftFinding[] {
  const unpaired = [...suite.scenarios];
  const findings: DriftFinding[] = [];
  for (const scenario of feature.scenarios) {
    const index = unpaired.findIndex((test) => test.title === scenario.title);
    if (index === -1) {
      findings.push({
        kind: 'scenario-missing',
        scenario: scenario.title,
        message: `scenario "${scenario.title}" at ${feature.file}:${scenario.line} has no test in ${suite.file}`,
        fix: emitFix,
      });
      continue;
    }
    const [test] = unpaired.splice(index, 1);
    const scope = {
      sentences,
      scenario: scenario.title,
      featureFile: feature.file,
      suiteFile: suite.file,
    };
    findings.push(...stepDrift(scope, scenario.steps, test.steps));
  }
  for (const test of unpaired) {
    findings.push({
      kind: 'extra-test',
      scenario: test.title,
      message: `test "${test.title}" has no scenario in ${feature.file}`,
      fix: editFix(suite.file, test.line),
    });
  }
  return findings;
}
