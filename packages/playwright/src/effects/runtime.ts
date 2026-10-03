import type { BlackboxEffects } from '../types.js';
import type { EffectContract } from './contract.js';

export type EffectEvaluation =
  | { readonly kind: 'satisfied' }
  | { readonly kind: 'unsatisfied'; readonly message: string }
  | { readonly kind: 'inconclusive'; readonly message: string };

export interface EffectContractEvaluator {
  evaluate(contract: EffectContract): Promise<EffectEvaluation>;
}

const evaluators = new WeakMap<BlackboxEffects, EffectContractEvaluator>();
const liveEffects = new WeakSet<BlackboxEffects>();

export function createBlackboxEffects(input: {
  readonly sessionId: string;
  readonly executionId: string;
  readonly evaluator: EffectContractEvaluator;
}): BlackboxEffects {
  const effects = Object.freeze({
    sessionId: input.sessionId,
    executionId: input.executionId,
  });
  evaluators.set(effects, input.evaluator);
  return effects;
}

export function evaluateBlackboxEffects(
  effects: BlackboxEffects,
  contract: EffectContract,
): Promise<EffectEvaluation> {
  const evaluator = evaluators.get(effects);
  if (evaluator === undefined) {
    return Promise.resolve({
      kind: 'inconclusive',
      message: 'Received value is not an effects fixture owned by this Playwright attempt.',
    });
  }
  return evaluator.evaluate(contract);
}

export function markBlackboxEffectsLive(effects: BlackboxEffects): void {
  liveEffects.add(effects);
}

export function isLiveBlackboxEffects(effects: BlackboxEffects): boolean {
  return liveEffects.has(effects);
}

export function createUnavailableBlackboxEffects(input: {
  readonly sessionId: string;
  readonly executionId: string;
}): BlackboxEffects {
  return createBlackboxEffects({
    ...input,
    evaluator: {
      evaluate: () =>
        Promise.resolve({
          kind: 'inconclusive',
          message:
            'Effect projection is not available. The attempt retained raw telemetry, but no projector supplied normalized effects.',
        }),
    },
  });
}
