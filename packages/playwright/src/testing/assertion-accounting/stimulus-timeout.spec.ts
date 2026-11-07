import { test as base } from '../../index.js';
import { createAttemptEffects } from '../../effects/attempt-effects.js';
import { createAttemptStep } from '../../steps/step-context.js';
import { createStateRegistry } from '../../state/registry.js';
import { createStimulusLifecycle } from '../../stimulus/lifecycle/runtime.js';
import type { RunningBlackboxAttempt } from '../../runtime/acquisition.js';

type Fixture = ReturnType<typeof createStimulusLifecycle>;
const test = base.extend<{ readonly lifecycle: Fixture }>({
  lifecycle: async ({ request }, use, info) => {
    const registry = createStateRegistry();
    registry.state.observe('state', { value: () => 0 });
    const effects = createAttemptEffects({ sessionId: 'session', executionId: 'attempt', storageDirectory: info.outputDir }).effects;
    const attempt = { sandbox: { executionId: 'attempt' }, telemetry: { sessionId: 'session' }, effects } as RunningBlackboxAttempt;
    const step = createAttemptStep(base.step.bind(base), attempt);
    const lifecycle = createStimulusLifecycle({ registry, request, step: step.step });
    try { await use(lifecycle); }
    finally {
      lifecycle.close();
      await info.attach('interrupted-lifecycle', { body: JSON.stringify(lifecycle.journal.events().map((event) => ({ kind: event.kind, ...('status' in event ? { status: event.status } : {}) }))), contentType: 'application/json' });
      step.revoke(); registry.close();
    }
  },
});
test('native timeout interrupts an action without inventing final state', async ({ lifecycle }) => {
  test.setTimeout(500);
  await lifecycle.stimulus('When action never settles', async () => {
    await new Promise<never>(() => undefined);
  });
});
