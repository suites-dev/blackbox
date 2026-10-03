import { expect as playwrightExpect } from '@playwright/test';

import type { BlackboxEffects } from '../types.js';
import { compileEffectContract, type EffectContractBuilder } from './contract.js';
import { evaluateBlackboxEffects } from './runtime.js';

export const expect = playwrightExpect.extend({
  async toSatisfy(received: BlackboxEffects, builder: EffectContractBuilder) {
    if (typeof builder !== 'function') {
      throw new TypeError('Use toSatisfy((effects) => [...])');
    }
    const contract = compileEffectContract(builder);
    const evaluation = await evaluateBlackboxEffects(received, contract);
    if (evaluation.kind === 'inconclusive') {
      throw new Error(evaluation.message);
    }
    const pass = evaluation.kind === 'satisfied';
    return {
      pass,
      message: () =>
        evaluation.kind === 'satisfied'
          ? 'Expected the effects contract not to be satisfied.'
          : evaluation.message,
    };
  },
});
