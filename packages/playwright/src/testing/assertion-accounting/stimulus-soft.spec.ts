import { expect as nativeExpect } from '@playwright/test';
import { test, expect } from '../../index.js';
import { completeGraph, recordedEffects } from '../../effects/testing/emissions.fixture.js';
import { createAttemptEffects } from '../../effects/attempt-effects.js';
import { createAttemptStep } from '../../steps/step-context.js';
import { createStateRegistry } from '../../state/registry.js';
import { createStimulusLifecycle } from '../../stimulus/lifecycle/runtime.js';
import type { RunningBlackboxAttempt } from '../../runtime/acquisition.js';
import { record } from './evidence.fixture.js';

test('soft failing precondition never invokes action', async ({ request }, info) => {
  const registry = createStateRegistry();
  const effects = createAttemptEffects({ sessionId: 'session', executionId: 'attempt', storageDirectory: info.outputDir }).effects;
  const attempt = { sandbox: { executionId: 'attempt' }, telemetry: { sessionId: 'session' }, effects } as RunningBlackboxAttempt;
  const step = createAttemptStep(test.step.bind(test), attempt);
  const lifecycle = createStimulusLifecycle({ registry, request, step: step.step });
  let calls = 0;
  await nativeExpect(lifecycle.stimulus('When blocked', () => { calls++; }, {
    precondition: { name: 'Given wrong state', check: () => { expect.soft(1).toBe(2); } },
  })).rejects.toThrow();
  nativeExpect(calls).toBe(0);
  nativeExpect(lifecycle.journal.events().filter((event) => event.kind === 'action')).toMatchObject([{ status: 'not-executed' }]);
  record('soft-precondition-blocked', calls);
  lifecycle.close(); step.revoke(); registry.close();
});

test('soft failure mixed with unavailable evidence remains failed', async ({ request }, info) => {
  const registry = createStateRegistry();
  const effects = createAttemptEffects({ sessionId: 'session', executionId: 'attempt', storageDirectory: info.outputDir }).effects;
  const attempt = { sandbox: { executionId: 'attempt' }, telemetry: { sessionId: 'session' }, effects } as RunningBlackboxAttempt;
  const step = createAttemptStep(test.step.bind(test), attempt);
  const lifecycle = createStimulusLifecycle({ registry, request, step: step.step });
  const graph = completeGraph([]);
  const open = { ...graph, scope: { ...graph.scope, closed: false }, quality: { ...graph.quality, coverage: 'partial' as const, reasons: ['open'] } };
  const selected = (await recordedEffects(open).capture()).http();
  const outcome = await lifecycle.stimulus('When mixed claims execute', () => 1);
  await nativeExpect(outcome.verify('Then a soft failure wins', async () => {
    expect.soft(1).toBe(2);
    await expect(selected).not.toHaveEmitted();
  })).rejects.toThrow();
  nativeExpect(lifecycle.journal.events().filter((event) => event.kind === 'claim')).toMatchObject([{ status: 'failed' }]);
  record('soft-mixed-failed', true);
  lifecycle.close(); step.revoke(); registry.close();
});
