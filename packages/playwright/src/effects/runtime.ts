import type { BlackboxEffects } from '../types.js';
import type { EffectContract } from './contract.js';
import type { EffectEvidenceArtifact } from './evaluation/artifact-types.js';

export type EffectEvaluation =
  | { readonly kind: 'satisfied' }
  | { readonly kind: 'unsatisfied'; readonly message: string }
  | { readonly kind: 'inconclusive'; readonly message: string };

export interface EffectContractEvaluator {
  evaluate(contract: EffectContract): Promise<EffectEvaluation>;
}

export interface EffectAssertionReport {
  readonly contract: EffectContract;
  readonly evaluation: EffectEvaluation;
  readonly evidence: EffectEvidenceArtifact | null;
  readonly negated: boolean;
}

export interface EffectAssertionReporter {
  effectAssertion(report: EffectAssertionReport): Promise<void>;
}

const evaluators = new WeakMap<BlackboxEffects, EffectContractEvaluator>();
const liveEffects = new WeakSet<BlackboxEffects>();
const expiredEffects = new WeakSet<BlackboxEffects>();
const evidence = new WeakMap<EffectEvaluation, EffectEvidenceArtifact>();
const reporters = new WeakMap<BlackboxEffects, EffectAssertionReporter>();
const closeCallbacks = new WeakMap<BlackboxEffects, () => void>();

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
  if (expiredEffects.has(effects)) {
    return Promise.resolve({
      kind: 'inconclusive',
      message: 'The effects fixture is no longer available after its Playwright attempt ended.',
    });
  }
  const evaluator = evaluators.get(effects);
  if (evaluator === undefined) {
    return Promise.resolve({
      kind: 'inconclusive',
      message: 'Received value is not an effects fixture owned by this Playwright attempt.',
    });
  }
  return evaluator.evaluate(contract);
}

export function retainEffectEvidence(
  evaluation: EffectEvaluation,
  artifact: EffectEvidenceArtifact,
): EffectEvaluation {
  evidence.set(evaluation, artifact);
  return evaluation;
}

export function bindEffectAssertionReporter(
  effects: BlackboxEffects,
  reporter: EffectAssertionReporter,
): void {
  reporters.set(effects, reporter);
}

export function registerBlackboxEffectsClose(
  effects: BlackboxEffects,
  close: () => void,
): void {
  if (expiredEffects.has(effects)) {
    close();
    return;
  }
  closeCallbacks.set(effects, close);
}

export function closeBlackboxEffects(effects: BlackboxEffects): void {
  if (expiredEffects.has(effects)) {
    return;
  }
  expiredEffects.add(effects);
  liveEffects.delete(effects);
  reporters.delete(effects);
  const close = closeCallbacks.get(effects);
  if (close !== undefined) {
    close();
  }
  closeCallbacks.delete(effects);
}

export async function reportEffectAssertion(input: {
  readonly effects: BlackboxEffects;
  readonly contract: EffectContract;
  readonly evaluation: EffectEvaluation;
  readonly negated: boolean;
}): Promise<void> {
  const reporter = reporters.get(input.effects);
  if (reporter === undefined) {
    return;
  }
  await reporter.effectAssertion({
    contract: input.contract,
    evaluation: input.evaluation,
    evidence: evidence.get(input.evaluation) ?? null,
    negated: input.negated,
  });
}

export function markBlackboxEffectsLive(effects: BlackboxEffects): void {
  if (!expiredEffects.has(effects)) {
    liveEffects.add(effects);
  }
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
