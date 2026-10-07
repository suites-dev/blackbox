import { describe, expect, it } from 'vitest';

import type { StepDefinition } from '../step-runtime/step-types.js';
import { library } from './index.js';
import { barrierSteps } from './steps/barrier.js';
import { responseSteps } from './steps/response.js';
import { setupSteps } from './steps/setup.js';
import { stateSteps } from './steps/state.js';
import { stimulusSteps } from './steps/stimulus.js';

// Requirement (hard rule 3, rule-dodging finding F1): no code loaded into a
// run can replace a reviewed step body. Every step definition is deep-frozen
// where it is declared, its body included, so a project module that assigns a
// new body to a library step is refused instead of a failing claim passing.

const STEP_MODULES = { setupSteps, stimulusSteps, barrierSteps, responseSteps, stateSteps };

describe('the shared step library is frozen where it is declared', () => {
  it.each(Object.entries(STEP_MODULES))(
    '%s: the list, every definition, its fixtures and its body',
    (_name, steps) => {
      expect(Object.isFrozen(steps)).toBe(true);
      for (const definition of steps) {
        expect(Object.isFrozen(definition), definition.expression).toBe(true);
        expect(Object.isFrozen(definition.fixtures), definition.expression).toBe(true);
        expect(Object.isFrozen(definition.run), definition.expression).toBe(true);
      }
    },
  );

  it('refuses a replaced, redefined or removed step, so the reviewed body is the one that resolves', () => {
    const [status] = responseSteps;
    const reviewed = status.run;
    const replacement = () => Promise.resolve();
    expect(() => {
      (status as { run: StepDefinition['run'] }).run = replacement;
    }).toThrow(TypeError);
    expect(() => Object.defineProperty(status, 'run', { value: replacement })).toThrow(TypeError);
    expect(() => (responseSteps as StepDefinition[]).splice(0, 1)).toThrow(TypeError);
    expect(() => (status.fixtures as string[]).push('page')).toThrow(TypeError);
    expect(status.run).toBe(reviewed);
    expect(library.resolve('the response status is 200')).toMatchObject({
      status: 'resolved',
      definition: status,
    });
  });
});
