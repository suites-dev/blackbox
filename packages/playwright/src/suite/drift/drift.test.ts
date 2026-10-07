import { describe, expect, it } from 'vitest';

import type { FeatureOutline, SuiteOutline, SuiteStep } from '../outline.js';
import { sentences } from '../sentences.js';
import { FEATURE, READY, SUBSCRIBE } from '../testing/feature.js';
import { SUITE } from '../testing/suite.js';
import { findDrift } from './drift.js';

// Requirement: drift compares a feature outline with its suite outline in
// both directions. Each finding names its fix: the emit command for what the
// suite is missing, or the suite file and line for what must be edited. A
// renamed scenario is one missing plus one extra; TODO and written bodies are
// not drift.

const EMIT = { kind: 'emit', text: 'run `blackbox feature suite emit`' };
const at = (line: number) => ({
  kind: 'edit',
  file: 'tests/subscription.spec.ts',
  line,
  text: `fix the suite at tests/subscription.spec.ts:${line}`,
});

const [ready, subscribe] = SUITE.scenarios;

function withReadySteps(steps: readonly SuiteStep[]): SuiteOutline {
  return { ...SUITE, scenarios: [{ ...ready, steps }, subscribe] };
}

function withFeatureReady(steps: FeatureOutline['scenarios'][number]['steps']): FeatureOutline {
  return { ...FEATURE, scenarios: [{ ...FEATURE.scenarios[0], steps }, FEATURE.scenarios[1]] };
}

const drift = (feature: FeatureOutline, suite: SuiteOutline) =>
  findDrift(feature, suite, sentences);

describe('findDrift: scenarios', () => {
  it('finds nothing when the suite matches the feature, TODO bodies included', () => {
    expect(drift(FEATURE, SUITE)).toEqual([]);
  });

  it('a scenario missing from the suite: run emit', () => {
    expect(drift(FEATURE, { ...SUITE, scenarios: [subscribe] })).toEqual([
      {
        kind: 'scenario-missing',
        scenario: READY,
        message: `scenario "${READY}" at features/subscription.feature:4 has no test in tests/subscription.spec.ts`,
        fix: EMIT,
      },
    ]);
  });

  it('an extra test with no scenario: fix the suite at the test', () => {
    const extra = { title: 'a leftover test', line: 40, steps: [] };
    expect(drift(FEATURE, { ...SUITE, scenarios: [...SUITE.scenarios, extra] })).toEqual([
      {
        kind: 'extra-test',
        scenario: 'a leftover test',
        message: 'test "a leftover test" has no scenario in features/subscription.feature',
        fix: at(40),
      },
    ]);
  });

  it('a renamed scenario is one missing and one extra, never linked', () => {
    const renamed = {
      ...FEATURE,
      scenarios: [{ ...FEATURE.scenarios[0], title: 'the API is ready' }, FEATURE.scenarios[1]],
    };
    expect(
      drift(renamed, SUITE).map((finding) => [finding.kind, finding.scenario, finding.fix]),
    ).toEqual([
      ['scenario-missing', 'the API is ready', EMIT],
      ['extra-test', READY, at(10)],
    ]);
  });
});

describe('findDrift: steps', () => {
  it('a step missing from a test: run emit', () => {
    expect(drift(FEATURE, withReadySteps([ready.steps[0], ready.steps[2]]))).toEqual([
      {
        kind: 'step-missing',
        scenario: READY,
        message:
          'step "Then the response status is 200" at features/subscription.feature:6 is missing from the test',
        fix: EMIT,
      },
    ]);
  });

  it('an extra step in a test: fix the suite at the step', () => {
    const extra = {
      keyword: 'And',
      text: 'the response status is 200',
      line: 21,
      body: { kind: 'written' },
    } as const;
    expect(drift(FEATURE, withReadySteps([...ready.steps, extra]))).toEqual([
      {
        kind: 'step-extra',
        scenario: READY,
        message: 'step "And the response status is 200" is not a step of the scenario',
        fix: at(21),
      },
    ]);
  });

  it('a step out of order: fix the suite at the step', () => {
    const [send, status, body] = ready.steps;
    expect(drift(FEATURE, withReadySteps([send, body, status]))).toEqual([
      {
        kind: 'step-out-of-order',
        scenario: READY,
        message:
          'step "Then the response status is 200" is out of order: the feature has it at features/subscription.feature:6',
        fix: at(15),
      },
    ]);
  });

  it('a changed value in the feature: fix the suite at the step', () => {
    const [send, status, body] = FEATURE.scenarios[0].steps;
    const changed = withFeatureReady([
      send,
      { ...status, text: 'the response status is 204' },
      body,
    ]);
    expect(drift(changed, SUITE)).toEqual([
      {
        kind: 'changed-value',
        scenario: READY,
        message:
          'step "Then the response status is 200" differs from the feature step "Then the response status is 204" at features/subscription.feature:6',
        fix: at(15),
      },
    ]);
  });

  it('a changed doc string or keyword is a changed value too', () => {
    const [send, status, body] = FEATURE.scenarios[0].steps;
    const docString = withFeatureReady([
      send,
      status,
      { ...body, argument: { kind: 'doc-string', content: '"starting"', mediaType: 'json' } },
    ]);
    const keyword = withFeatureReady([send, { ...status, keyword: 'And' }, body]);
    expect(drift(docString, SUITE).map((finding) => [finding.kind, finding.fix])).toEqual([
      ['changed-value', at(18)],
    ]);
    expect(drift(keyword, SUITE).map((finding) => [finding.kind, finding.fix])).toEqual([
      ['changed-value', at(15)],
    ]);
  });
});

describe('findDrift: step bodies', () => {
  it('an edited library call: fix the suite at the step', () => {
    const [send, status, body] = ready.steps;
    const edited = { ...status, body: { ...status.body, values: [201] } };
    expect(drift(FEATURE, withReadySteps([send, edited, body]))).toEqual([
      {
        kind: 'edited-library-call',
        scenario: READY,
        message:
          'step "Then the response status is 200" has a library call that is not the call for its step line',
        fix: at(15),
      },
    ]);
    const otherSentence = {
      ...status,
      body: { ...status.body, expression: 'the response status is {int} ', values: [200] },
    };
    expect(
      drift(FEATURE, withReadySteps([send, otherSentence, body])).map((finding) => finding.kind),
    ).toEqual(['edited-library-call']);
  });

  it('written and TODO bodies are not drift, whatever they hold', () => {
    const written = ready.steps.map((step) => ({ ...step, body: { kind: 'written' } }) as const);
    const todo = ready.steps.map((step) => ({ ...step, body: { kind: 'todo' } }) as const);
    expect(drift(FEATURE, withReadySteps(written))).toEqual([]);
    expect(drift(FEATURE, withReadySteps(todo))).toEqual([]);
  });

  it('reports drift in the other scenario independently', () => {
    const [post, created, state] = subscribe.steps;
    const suite = { ...SUITE, scenarios: [ready, { ...subscribe, steps: [post, created, state] }] };
    expect(drift(FEATURE, suite).map((finding) => [finding.kind, finding.scenario])).toEqual([
      ['step-missing', SUBSCRIBE],
    ]);
  });
});
