import { describe, expect, expectTypeOf, it } from 'vitest';

import type { BlackboxEffects, BlackboxSandbox, BlackboxTelemetry } from '@suites/blackbox-playwright';

import { sandboxEnvironment } from './environment.js';
import { createStepLibrary } from './registry.js';
import { createStepRunner } from './run-step.js';
import type { BlackboxStep, StepDefinition, StepFixtures, StepInput } from './step-types.js';

// Requirements (task 2.2): each compiled step runs as a native boxed step
// whose location is the .feature line, with the library's parsed parameters;
// a step the installed library no longer resolves, or whose capability it does
// not offer, fails at run time instead of running something nobody compiled.
// Sandbox environments name variables only and fail when one is missing.

type StepInfo = Parameters<Parameters<BlackboxStep>[1]>[0];

const feature = new URL('file:///project/features/subscribe.feature');
const site = { feature, line: 12, column: 5, keyword: 'When' };

function harness(capabilities: readonly ('effects-claims' | 'participant-exec')[] = []) {
  const inputs: StepInput[] = [];
  const definition = (expression: string, requires: StepDefinition['requires'] = null): StepDefinition => ({
    expression,
    kind: 'stimulus',
    argument: 'none',
    fixtures: ['world'],
    requires,
    run: (input) => {
      inputs.push(input);
      return Promise.resolve();
    },
  });
  const library = createStepLibrary({
    name: 'n',
    version: '1',
    definitions: [definition('the client sends {word} {string}'), definition('the effects hold', 'effects-claims')],
    capabilities,
  });
  const steps: { title: string; options: unknown }[] = [];
  // The runner ignores the step info Playwright passes to a step body.
  const step: BlackboxStep = async (title, body, options) => {
    steps.push({ title, options });
    return body({} as StepInfo);
  };
  return { inputs, steps, runStep: createStepRunner(library, step) };
}

describe('createStepRunner', () => {
  it('runs a native boxed step at the .feature location with the parsed parameters', async () => {
    const { inputs, steps, runStep } = harness();
    const fixtures = { world: new Map() };
    await runStep(fixtures, site, 'the client sends GET "/health"', { kind: 'none' });
    expect(steps).toEqual([
      {
        title: 'When the client sends GET "/health"',
        options: { location: { file: '/project/features/subscribe.feature', line: 12, column: 5 }, box: true },
      },
    ]);
    expect(inputs).toEqual([{ fixtures, parameters: ['GET', '/health'], argument: { kind: 'none' } }]);
  });

  it('fails without running a step that no longer resolves or whose capability is not offered', async () => {
    const { inputs, steps, runStep } = harness();
    await expect(runStep({}, site, 'the agent invents a step', { kind: 'none' })).rejects.toThrow(
      '/project/features/subscribe.feature:12:5: step "When the agent invents a step" is not defined by the step library; recompile the feature',
    );
    await expect(runStep({}, site, 'the effects hold', { kind: 'none' })).rejects.toThrow(
      'step "When the effects hold" needs capability "effects-claims", which this Blackbox runtime does not offer; recompile the feature',
    );
    expect(steps).toEqual([]);
    expect(inputs).toEqual([]);
  });
});

describe('sandboxEnvironment', () => {
  it('reads each variable from the runner environment', () => {
    expect(
      sandboxEnvironment({ FIXTURE_CONTROL_TOKEN: { fromEnv: 'E2E_TOKEN' } }, { E2E_TOKEN: 'secret', OTHER: 'x' }),
    ).toEqual({ FIXTURE_CONTROL_TOKEN: 'secret' });
  });

  it('fails when a variable is not set', () => {
    expect(() => sandboxEnvironment({ FIXTURE_CONTROL_TOKEN: { fromEnv: 'E2E_TOKEN' } }, {})).toThrow(
      'Sandbox environment FIXTURE_CONTROL_TOKEN reads E2E_TOKEN, which is not set in the runner environment',
    );
  });
});

describe('step fixture types', () => {
  it('are the facade fixtures, read from its public signatures', () => {
    // Checked by the typecheck: a derivation that collapsed to any or unknown would fail here.
    expectTypeOf<NonNullable<StepFixtures['sandbox']>>().toEqualTypeOf<BlackboxSandbox>();
    expectTypeOf<NonNullable<StepFixtures['telemetry']>>().toEqualTypeOf<BlackboxTelemetry>();
    expectTypeOf<NonNullable<StepFixtures['effects']>>().toEqualTypeOf<BlackboxEffects>();
    expectTypeOf<NonNullable<StepFixtures['request']>>().not.toBeAny();
    expectTypeOf<NonNullable<StepFixtures['request']>['fetch']>().toBeFunction();
    expectTypeOf<NonNullable<StepFixtures['page']>>().not.toBeAny();
    expectTypeOf<NonNullable<StepFixtures['page']>['goto']>().toBeFunction();
  });
});
