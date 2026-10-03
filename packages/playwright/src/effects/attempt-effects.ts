import { AttemptActivities } from '../activities/execution/attempt-activities.js';
import type { BlackboxActivities, BlackboxActivityActions } from '../activities/public-types.js';
import {
  evaluateBlackboxEffects,
  createBlackboxEffects,
  markBlackboxEffectsLive,
  registerBlackboxEffectsClose,
} from './runtime.js';
import { createScopedBlackboxEffects } from './scoped-effects.js';

export function createAttemptEffects(input: {
  readonly sessionId: string;
  readonly executionId: string;
  readonly storageDirectory: string;
  readonly entrypointUrl: string;
}): {
  readonly effects: ReturnType<typeof createBlackboxEffects>;
  readonly activities: BlackboxActivities;
} {
  const attempt = new AttemptActivities(input);

  const effects = createBlackboxEffects({
    sessionId: input.sessionId,
    executionId: input.executionId,
    evaluator: {
      async evaluate(contract) {
        const completed = attempt.completedStimuli();
        if (completed.kind === 'none') {
          return {
            kind: 'inconclusive',
            message: 'No completed stimulus activity is available for this Playwright attempt.',
          };
        }
        const selected = createScopedBlackboxEffects({
          storageDirectory: input.storageDirectory,
          selection: completed.selection,
        });
        return evaluateBlackboxEffects(selected, contract);
      },
    },
  });
  registerBlackboxEffectsClose(effects, () => {
    attempt.close();
  });
  markBlackboxEffectsLive(effects);
  return {
    effects,
    activities: attempt.activities,
  };
}

export function createUnavailableBlackboxActivities(): BlackboxActivities {
  const unavailable = (): never => {
    throw new Error('The configured Blackbox runtime does not provide activity execution.');
  };
  const actions = Object.freeze({
    run: unavailable,
    request: unavailable,
    browser: unavailable,
  }) as BlackboxActivityActions;
  return Object.freeze({ setup: actions, stimulus: actions, inspection: actions });
}
