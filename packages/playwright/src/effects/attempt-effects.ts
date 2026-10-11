import { AsyncLocalStorage } from 'node:async_hooks';
import type { APIResponse } from '@playwright/test';
import type { SandboxRequestDispatch } from '../request/sandbox-request.js';
import { AttemptStimuli, stimulusHeaders } from '../activities/execution/attempt-stimuli.js';
import type { BlackboxStimulusScope } from '../steps/types.js';
import type { BlackboxEffects } from '../types.js';
import {
  evaluateBlackboxEffects,
  createBlackboxEffects,
  markBlackboxEffectsLive,
  registerBlackboxEffectsClose,
} from './runtime.js';
import { createScopedBlackboxEffects } from './scoped-effects.js';

const attempts = new WeakMap<BlackboxEffects, AttemptStimuli>();
const stimulus = new AsyncLocalStorage<{
  readonly effects: BlackboxEffects;
  readonly scope: BlackboxStimulusScope;
}>();

export function runEffectStimulus<T>(
  effects: BlackboxEffects,
  title: string,
  action: (scope: BlackboxStimulusScope) => T | Promise<T>,
): Promise<T> {
  const attempt = attempts.get(effects);
  if (attempt === undefined) {
    return Promise.reject(new Error('This Blackbox attempt does not provide stimulus execution.'));
  }
  return attempt.run(title, (scope) => stimulus.run({ effects, scope }, () => action(scope)));
}

/** Effects composition only; generic request routing knows neither stimuli nor tracing. */
export function automaticEffectRequest(
  effects: BlackboxEffects,
  input: SandboxRequestDispatch,
): Promise<APIResponse> {
  if (!attempts.has(effects)) {
    return input.dispatch(input.options);
  }
  const dispatch = (scope: BlackboxStimulusScope): Promise<APIResponse> =>
    input.dispatch({
      ...input.options,
      headers: stimulusHeaders(
        scope,
        (input.options === undefined ? {} : input.options.headers) ?? {},
      ),
    });
  const current = stimulus.getStore();
  return current !== undefined && current.effects === effects
    ? dispatch(current.scope)
    : runEffectStimulus(effects, `HTTP ${input.method} entrypoint request`, dispatch);
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
