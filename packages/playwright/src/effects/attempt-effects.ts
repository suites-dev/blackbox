import { AttemptStimuli, type CompletedStimuli } from '../activities/execution/attempt-stimuli.js';
import type { BlackboxStimulusScope } from '../steps/types.js';
import type { RequestEntry } from '../stimulus/summary.js';
import type { BlackboxEffects } from '../types.js';
import {
  evaluateBlackboxEffects,
  createBlackboxEffects,
  markBlackboxEffectsLive,
  registerBlackboxEffectsClose,
} from './runtime.js';
import { createScopedBlackboxEffects } from './scoped-effects.js';

const attempts = new WeakMap<BlackboxEffects, AttemptStimuli>();

export function runEffectStimulus<T>(
  effects: BlackboxEffects,
  title: string,
  action: (scope: BlackboxStimulusScope) => T | Promise<T>,
): Promise<T> {
  const attempt = attempts.get(effects);
  if (attempt === undefined) {
    return Promise.reject(new Error('This Blackbox attempt does not provide stimulus execution.'));
  }
  return attempt.run(title, action);
}

/** The stimulus activities the attempt completed so far; call it before the effects fixture closes. */
export function completedAttemptStimuli(effects: BlackboxEffects): CompletedStimuli {
  const attempt = attempts.get(effects);
  return attempt === undefined ? { kind: 'none' } : attempt.completed();
}

export type RecordedStimuli = ReturnType<AttemptStimuli['recorded']>;

/** What the test sent during its stimulus activities; call it before the effects fixture closes. */
export function recordedAttemptStimuli(effects: BlackboxEffects): RecordedStimuli {
  const attempt = attempts.get(effects);
  return attempt === undefined ? { stimuli: [], unscoped: 0, opaque: 0 } : attempt.recorded();
}

export function recordStimulusRequest(
  effects: BlackboxEffects,
  input: {
    readonly entry: RequestEntry;
    readonly entrypointUrl: string | null;
    readonly opaque: boolean;
  },
): void {
  const attempt = attempts.get(effects);
  if (attempt !== undefined) {
    attempt.record(input.entry, input.entrypointUrl, input.opaque);
  }
}

export function createAttemptEffects(input: {
  readonly sessionId: string;
  readonly executionId: string;
  readonly storageDirectory: string;
}): {
  readonly effects: ReturnType<typeof createBlackboxEffects>;
} {
  const attempt = new AttemptStimuli(input);

  const effects = createBlackboxEffects({
    sessionId: input.sessionId,
    executionId: input.executionId,
    evaluator: {
      async evaluate(contract) {
        const completed = attempt.completed();
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
  return { effects };
}
