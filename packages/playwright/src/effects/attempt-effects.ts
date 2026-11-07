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
import { createScopedObservationSource } from '../activities/scoped-observations.js';
import {
  captureEffectObservations,
  unavailableEffectCapture,
  type CapturedEffects,
} from './emissions/capture.js';

const attempts = new WeakMap<BlackboxEffects, AttemptStimuli>();
const activityCaptures = new WeakMap<
  BlackboxEffects,
  (activityId: string) => Promise<CapturedEffects>
>();

/** Capture a single completed activity. An unavailable read is a capture operation failure. */
export function captureAttemptActivity(
  effects: BlackboxEffects,
  activityId: string,
): Promise<CapturedEffects> {
  const capture = activityCaptures.get(effects);
  if (capture === undefined) {
    return Promise.reject(new Error('This Blackbox attempt does not provide activity capture.'));
  }
  return capture(activityId);
}

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

async function captureActivity(input: {
  readonly attempt: AttemptStimuli;
  readonly activityId: string;
  readonly storageDirectory: string;
}): Promise<CapturedEffects> {
  const completed = input.attempt.completedActivity(input.activityId);
  if (completed.kind !== 'selected') {
    throw new Error('The stimulus activity is not completed by this attempt.');
  }
  const selection = completed.selection;
  const captured = await captureEffectObservations({
    identity: {
      sessionId: selection.sessionId,
      executionId: selection.executionId,
      scopeId: selection.scopeId,
      activityIds: selection.activities.map(({ activityId }) => activityId),
    },
    source: createScopedObservationSource({
      selection,
      storageDirectory: input.storageDirectory,
      requireLiveCollector: true,
    }),
  });
  if (captured.evidence === null) {
    throw new Error('The stimulus effects capture could not be admitted.');
  }
  return captured;
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
    async capture() {
      const completed = attempt.completed();
      if (completed.kind !== 'selected') {
        return unavailableEffectCapture({
          ...input,
          message: completed.kind === 'partial' ? completed.message : 'No completed stimulus activity is available for this Playwright attempt.',
        });
      }
      const selection = completed.selection;
      return captureEffectObservations({
        identity: {
          sessionId: selection.sessionId,
          executionId: selection.executionId,
          scopeId: selection.scopeId,
          activityIds: selection.activities.map(({ activityId }) => activityId),
        },
        source: createScopedObservationSource({
          selection,
          storageDirectory: input.storageDirectory,
        }),
      });
    },
    evaluator: {
      async evaluate(contract) {
        const completed = attempt.completed();
        if (completed.kind !== 'selected') {
          return {
            kind: 'inconclusive',
            message: completed.kind === 'partial' ? completed.message : 'No completed stimulus activity is available for this Playwright attempt.',
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
    activityCaptures.delete(effects);
  });
  activityCaptures.set(effects, (activityId) =>
    captureActivity({ attempt, activityId, storageDirectory: input.storageDirectory }),
  );
  markBlackboxEffectsLive(effects);
  attempts.set(effects, attempt);
  return { effects };
}
