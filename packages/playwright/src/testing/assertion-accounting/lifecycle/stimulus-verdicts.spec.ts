import { expect as nativeExpect } from '@playwright/test';
import { test as base, expect, assertionScope } from '../../../index.js';
import { createAttemptEffects } from '../../../effects/attempt-effects.js';
import { completeGraph, recordedEffects } from '../../../effects/testing/emissions.fixture.js';
import { createAttemptStep } from '../../../steps/step-context.js';
import { createStateRegistry } from '../../../state/registry.js';
import { createStimulusLifecycle } from '../../../stimulus/lifecycle/runtime.js';
import type { RunningBlackboxAttempt } from '../../../runtime/acquisition.js';

const test = base.extend<{ readonly lifecycle: ReturnType<typeof createStimulusLifecycle> }>({
  lifecycle: async ({ request }, use, info) => {
    const registry = createStateRegistry();
    const effects = createAttemptEffects({ sessionId: 'session', executionId: 'attempt', storageDirectory: info.outputDir }).effects;
    const attempt = { sandbox: { executionId: 'attempt' }, telemetry: { sessionId: 'session' }, effects } as RunningBlackboxAttempt;
    const step = createAttemptStep(base.step.bind(base), attempt);
    const lifecycle = createStimulusLifecycle({ registry, request, step: step.step });
    try { await use(lifecycle); }
    finally { try { lifecycle.close(); } finally { step.revoke(); registry.close(); } }
  },
});
async function unavailable() {
  const graph = completeGraph([]);
  const open = { ...graph, scope: { ...graph.scope, closed: false }, quality: { ...graph.quality, coverage: 'partial' as const, reasons: ['open'] } };
  return (await recordedEffects(open).capture()).http();
}

test('nested scope failures cannot become inconclusive', async ({ lifecycle }) => {
  const selected = await unavailable();
  const outcome = await lifecycle.stimulus('When action completes', () => 1);
  for (const callback of [() => undefined, () => { throw new Error('verification setup failed'); }]) {
    await nativeExpect(outcome.verify('Then existing failure remains failed', async () => {
      try { await assertionScope(callback); } catch { /* deliberately caught scope failure */ }
      await expect(selected).not.toHaveEmitted();
    })).rejects.toThrow();
  }
  nativeExpect(lifecycle.journal.events().filter((event) => event.kind === 'claim').map(({ status }) => status)).toEqual(['failed', 'failed']);
});

test('pure inconclusive assertions retain their verdict', async ({ lifecycle }) => {
  const selected = await unavailable();
  const outcome = await lifecycle.stimulus('When action completes', () => 1);
  await nativeExpect(outcome.verify('Then unavailable evidence is inconclusive', async () => {
    await expect(selected).not.toHaveEmitted();
  })).rejects.toThrow();
  await nativeExpect(outcome.verify('And nested unavailable evidence stays inconclusive', async () => {
    try { await assertionScope(async () => { await expect(selected).not.toHaveEmitted(); }); }
    catch { /* deliberately caught inconclusive scope */ }
    await expect(selected).not.toHaveEmitted();
  })).rejects.toThrow();
  nativeExpect(lifecycle.journal.events().filter((event) => event.kind === 'claim').map(({ status }) => status)).toEqual(['inconclusive', 'inconclusive']);
});
