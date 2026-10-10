import { AttemptActivities } from '../activities/execution/attempt-activities.js';
import type { BlackboxActivities, BlackboxActivityContext } from '../activities/public-types.js';
import type { BlackboxEffects } from '../types.js';
import {
  evaluateBlackboxEffects,
  createBlackboxEffects,
  markBlackboxEffectsLive,
  registerBlackboxEffectsClose,
} from './runtime.js';
import { createScopedBlackboxEffects } from './scoped-effects.js';

const attempts = new WeakMap<BlackboxEffects, AttemptActivities>();

export function runEffectStimulus<T>(
  effects: BlackboxEffects,
  title: string,
  action: (context: BlackboxActivityContext) => T | Promise<T>,
): Promise<T> {
  const attempt = attempts.get(effects);
  if (attempt === undefined) {
    return Promise.reject(new Error('This Blackbox attempt does not provide stimulus execution.'));
  }
  return attempt.runStimulus(title, action);
}

export function createAttemptEffects(input: {
  readonly sessionId: string;
  readonly executionId: string;
  readonly storageDirectory: string;
  readonly entrypointUrl: string;
}): {
  readonly effects: ReturnType<typeof createBlackboxEffects>;
  /** Internal harness for lower-level selection tests; not a Playwright fixture. */
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
    attempts.delete(effects);
  });
  markBlackboxEffectsLive(effects);
  attempts.set(effects, attempt);
  return { effects, activities: attempt.activities };
}
