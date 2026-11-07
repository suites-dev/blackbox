import { expect as nativeExpect } from '@playwright/test';
import { test, expect } from '../../../index.js';
import { createAttemptEffects } from '../../../effects/attempt-effects.js';
import { createAttemptStep } from '../../../steps/step-context.js';
import { createStateRegistry } from '../../../state/registry.js';
import { createStimulusLifecycle } from '../../../stimulus/lifecycle/runtime.js';
import type { RunningBlackboxAttempt } from '../../../runtime/acquisition.js';

test('frozen selection excludes observers registered while the action runs', async ({ request }, info) => {
  const registry = createStateRegistry();
  const effects = createAttemptEffects({ sessionId: 'session', executionId: 'attempt', storageDirectory: info.outputDir }).effects;
  const attempt = { sandbox: { executionId: 'attempt' }, telemetry: { sessionId: 'session' }, effects } as RunningBlackboxAttempt;
  const step = createAttemptStep(test.step.bind(test), attempt);
  const lifecycle = createStimulusLifecycle({ registry, request, step: step.step });
  let value = 0; let reads = 0; let lateReads = 0;
  const observed = registry.state.observe('observed', { value: () => { reads++; return value; } });
  let preconditionInitial = -1;
  let late: ReturnType<typeof registry.state.observe>;
  const outcome = await lifecycle.stimulus('When state changes', () => {
    late = registry.state.observe('late', { value: () => { lateReads++; return value; } });
    value = 1;
  }, { precondition: { name: 'Given initial state', check: ({ initial }) => {
    preconditionInitial = initial(observed).value;
    expect(preconditionInitial).toBe(0);
  } } });
  const comparison = outcome.evidence.state(observed);
  nativeExpect(comparison.initial.value).toBe(preconditionInitial);
  nativeExpect(comparison.final.value).toBe(1);
  nativeExpect(comparison.diff.value).toEqual({ before: 0, after: 1, changed: true });
  nativeExpect(reads).toBe(2);
  nativeExpect(lateReads).toBe(0);
  nativeExpect(() => outcome.evidence.state(late)).toThrow(/registered after selection/);
  lifecycle.close(); step.revoke(); registry.close();
});
