import { expect as playwrightExpect } from '@playwright/test';
import { setTimeout as delay } from 'node:timers/promises';

import type { BlackboxEffects } from '../types.js';
import { compileEffectContract, type EffectContractBuilder } from './contract.js';
import {
  evaluateBlackboxEffects,
  isLiveBlackboxEffects,
  reportEffectAssertion,
} from './runtime.js';

export const expect = playwrightExpect.extend({
  async toSatisfy(received: BlackboxEffects, builder: EffectContractBuilder) {
    if (typeof builder !== 'function') {
      throw new TypeError('Use toSatisfy((effects) => [...])');
    }
    const contract = compileEffectContract(builder);
    const deadline = Date.now() + this.timeout;
    let evaluation = await evaluateBlackboxEffects(received, contract);
    while (
      evaluation.kind === 'inconclusive' &&
      isLiveBlackboxEffects(received) &&
      Date.now() < deadline
    ) {
      await delay(Math.min(50, Math.max(1, deadline - Date.now())));
      evaluation = await evaluateBlackboxEffects(received, contract);
    }
    if (evaluation.kind === 'inconclusive') {
      await reportEffectAssertion({
        effects: received,
        contract,
        evaluation,
        negated: this.isNot,
      });
      throw new Error(evaluation.message);
    }
    const pass = evaluation.kind === 'satisfied';
    await reportEffectAssertion({ effects: received, contract, evaluation, negated: this.isNot });
    return {
      pass,
      message: () =>
        evaluation.kind === 'satisfied'
          ? 'Expected the effects contract not to be satisfied.'
          : evaluation.message,
    };
  },
});
