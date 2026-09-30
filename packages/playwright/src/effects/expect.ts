import { expect as playwrightExpect } from '@playwright/test';

import type { BlackboxEffects } from '../types.js';
import { compileEffectContract, type EffectContractBuilder } from './contract.js';
import { evaluateBlackboxEffects } from './runtime.js';

export const expect = playwrightExpect.extend({
  async toSatisfy(received: BlackboxEffects, builder: EffectContractBuilder) {
    const contract = compileEffectContract(builder);
    const evaluation = await evaluateBlackboxEffects(received, contract);
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
