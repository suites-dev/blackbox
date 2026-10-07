import { matchSentence, type SentenceMatch } from '../match.js';
import type { FeatureStep, StepArgument, StepValue, SuiteStep } from '../outline.js';
import type { Sentence } from '../sentences.js';
import { editFix, emitFix, type DriftFinding } from './findings.js';

// Step drift inside one scenario and its test. Steps are aligned by identity:
// the library sentence a step text matches, or the text itself when it
// matches none, so a changed value keeps a step aligned with its feature line.
// The longest common subsequence of identities is in order; a step left over
// on both sides is out of order, one left over on one side is missing or extra.

interface Located<Step> {
  readonly step: Step;
  readonly match: SentenceMatch;
  readonly identity: string;
}

export interface StepScope {
  readonly sentences: readonly Sentence[];
  readonly scenario: string;
  readonly featureFile: string;
  readonly suiteFile: string;
}

function locate<Step extends { readonly text: string }>(
  step: Step,
  sentences: readonly Sentence[],
): Located<Step> {
  const match = matchSentence(sentences, step.text);
  return {
    step,
    match,
    identity: match.kind === 'known' ? `sentence ${match.expression}` : `text ${step.text}`,
  };
}

/** Index pairs of a longest common subsequence of the two identity lists. */
function commonSubsequence(
  left: readonly string[],
  right: readonly string[],
): readonly (readonly [number, number])[] {
  const lengths = Array.from({ length: left.length + 1 }, () =>
    new Array<number>(right.length + 1).fill(0),
  );
  for (let i = left.length - 1; i >= 0; i -= 1) {
    for (let j = right.length - 1; j >= 0; j -= 1) {
      lengths[i][j] =
        left[i] === right[j]
          ? lengths[i + 1][j + 1] + 1
          : Math.max(lengths[i + 1][j], lengths[i][j + 1]);
    }
  }
  const pairs: (readonly [number, number])[] = [];
  let [i, j] = [0, 0];
  while (i < left.length && j < right.length) {
    if (left[i] === right[j]) {
      pairs.push([i, j]);
      [i, j] = [i + 1, j + 1];
    } else if (lengths[i + 1][j] >= lengths[i][j + 1]) {
      i += 1;
    } else {
      j += 1;
    }
  }
  return pairs;
}

const sameValues = (left: readonly StepValue[], right: readonly StepValue[]) =>
  left.length === right.length && left.every((value, index) => value === right[index]);

const sameArgument = (left: StepArgument, right: StepArgument) =>
  JSON.stringify(left) === JSON.stringify(right);

const line = (step: { readonly keyword: string; readonly text: string }) =>
  `${step.keyword} ${step.text}`;

function valuesOf(match: SentenceMatch): readonly StepValue[] {
  return match.kind === 'known' ? match.values : [];
}

function changedValue(feature: Located<FeatureStep>, suite: Located<SuiteStep>): boolean {
  const { body } = suite.step;
  return (
    feature.step.keyword !== suite.step.keyword ||
    !sameValues(valuesOf(feature.match), valuesOf(suite.match)) ||
    (body.kind === 'library' && !sameArgument(body.argument, feature.step.argument))
  );
}

/** A library-call body that is not the call for its own step line. */
function editedCall(suite: Located<SuiteStep>): boolean {
  const { body } = suite.step;
  if (body.kind !== 'library') {
    return false;
  }
  return (
    suite.match.kind !== 'known' ||
    body.expression !== suite.match.expression ||
    !sameValues(body.values, suite.match.values)
  );
}

function alignedFindings(
  scope: StepScope,
  feature: Located<FeatureStep>,
  suite: Located<SuiteStep>,
): readonly DriftFinding[] {
  const at = editFix(scope.suiteFile, suite.step.line);
  return [
    ...(changedValue(feature, suite)
      ? [
          {
            kind: 'changed-value' as const,
            scenario: scope.scenario,
            message: `step "${line(suite.step)}" differs from the feature step "${line(feature.step)}" at ${scope.featureFile}:${feature.step.line}`,
            fix: at,
          },
        ]
      : []),
    ...(editedCall(suite)
      ? [
          {
            kind: 'edited-library-call' as const,
            scenario: scope.scenario,
            message: `step "${line(suite.step)}" has a library call that is not the call for its step line`,
            fix: at,
          },
        ]
      : []),
  ];
}

function leftoverFindings(
  scope: StepScope,
  features: readonly Located<FeatureStep>[],
  suites: readonly Located<SuiteStep>[],
): readonly DriftFinding[] {
  const remaining = [...suites];
  const findings: DriftFinding[] = [];
  for (const feature of features) {
    const index = remaining.findIndex((suite) => suite.identity === feature.identity);
    if (index === -1) {
      const message = `step "${line(feature.step)}" at ${scope.featureFile}:${feature.step.line} is missing from the test`;
      findings.push({ kind: 'step-missing', scenario: scope.scenario, message, fix: emitFix });
    } else {
      const [suite] = remaining.splice(index, 1);
      const message = `step "${line(suite.step)}" is out of order: the feature has it at ${scope.featureFile}:${feature.step.line}`;
      findings.push({
        kind: 'step-out-of-order',
        scenario: scope.scenario,
        message,
        fix: editFix(scope.suiteFile, suite.step.line),
      });
    }
  }
  for (const suite of remaining) {
    const message = `step "${line(suite.step)}" is not a step of the scenario`;
    findings.push({
      kind: 'step-extra',
      scenario: scope.scenario,
      message,
      fix: editFix(scope.suiteFile, suite.step.line),
    });
  }
  return findings;
}

/** Drift between a scenario's steps and its test's steps. */
export function stepDrift(
  scope: StepScope,
  featureSteps: readonly FeatureStep[],
  suiteSteps: readonly SuiteStep[],
): readonly DriftFinding[] {
  const features = featureSteps.map((step) => locate(step, scope.sentences));
  const suites = suiteSteps.map((step) => locate(step, scope.sentences));
  const pairs = commonSubsequence(
    features.map((step) => step.identity),
    suites.map((step) => step.identity),
  );
  const pairedFeatures = new Set(pairs.map(([index]) => index));
  const pairedSuites = new Set(pairs.map(([, index]) => index));
  return [
    ...pairs.flatMap(([featureIndex, suiteIndex]) =>
      alignedFindings(scope, features[featureIndex], suites[suiteIndex]),
    ),
    ...leftoverFindings(
      scope,
      features.filter((_step, index) => !pairedFeatures.has(index)),
      suites.filter((_step, index) => !pairedSuites.has(index)),
    ),
  ];
}
