import {
  compileEffectContract as compileStandaloneContract,
  effectContractBuilder as standaloneBuilder,
  type EffectContractBuilder as StandaloneContractBuilder,
} from '@suites/blackbox-effects';
import { describe, expect as check, it } from 'vitest';

import type { EffectContractBuilder as PlaywrightContractBuilder } from '../../index.js';
import { compileEffectContract, effectContractBuilder } from '../contract.js';
import { createEffectContractEvaluator } from '../evaluation/evaluator.js';
import type { EffectObservationReadResult } from '../evaluation/source.js';
import { expect } from '../expect.js';
import { createBlackboxEffects } from '../runtime.js';
import { attribute, payload, span } from './observations.fixture.js';

const exists: StandaloneContractBuilder = (effects) => [
  effects.exists(effects.db({ operation: 'INSERT' })),
];
const compatible: PlaywrightContractBuilder = exists;

function handle(read: EffectObservationReadResult) {
  return createBlackboxEffects({
    sessionId: 'adapter-session',
    executionId: 'adapter-execution',
    evaluator: createEffectContractEvaluator({ read: () => Promise.resolve(read) }),
  });
}

describe('standalone engine adapter', () => {
  it('reexports the same compiler and builder while preserving public Playwright types', () => {
    check(compileEffectContract).toBe(compileStandaloneContract);
    check(effectContractBuilder).toBe(standaloneBuilder);
    check(compileEffectContract(compatible)).toEqual(compileStandaloneContract(exists));
  });

  it('maps a real engine witness and contradiction to positive and negated matcher results', async () => {
    const effects = handle({
      kind: 'admitted',
      scopeId: 'adapter-scope',
      payloads: [payload([span(1, { attributes: [attribute('db.operation.name', 'INSERT')] })])],
      diagnostics: [],
    });
    await expect(effects).toSatisfy(compatible);
    await expect(effects).not.toSatisfy((e) => [e.absent(e.db({ operation: 'INSERT' }))]);
    await check(expect(effects).not.toSatisfy(compatible)).rejects.toThrow(
      'Expected the effects contract not to be satisfied',
    );
  });

  it('keeps missing evidence inconclusive under negation and retains source diagnostics', async () => {
    const effects = handle({
      kind: 'admitted',
      scopeId: 'adapter-scope',
      payloads: [],
      diagnostics: ['selected-trace-not-received'],
    });
    await check(expect(effects).toSatisfy(compatible)).rejects.toThrow(
      'selected-trace-not-received',
    );
    await check(expect(effects).not.toSatisfy(compatible)).rejects.toThrow(
      'Scope adapter-scope: inconclusive',
    );
  });
});

describe('Playwright source and authoring errors', () => {
  it.each(['unavailable', 'rejected'] as const)(
    'does not let negation accept a %s source',
    async (kind) => {
      const effects = handle({ kind, message: 'No trusted activity observations' });
      await check(expect(effects).not.toSatisfy(compatible)).rejects.toThrow(
        'No trusted activity observations',
      );
    },
  );

  it('reports malformed OTLP as inconclusive before matcher negation', async () => {
    const effects = handle({
      kind: 'admitted',
      scopeId: 'adapter-scope',
      payloads: [{}],
      diagnostics: [],
    });
    await check(expect(effects).not.toSatisfy(compatible)).rejects.toThrow('observation rejected');
  });

  it('keeps matcher-specific callback guidance outside the neutral compiler', async () => {
    const effects = handle({ kind: 'unavailable', message: 'must not reach the source' });
    check(() => {
      // @ts-expect-error Exercise a JavaScript caller supplying a non-callable builder.
      compileStandaloneContract(undefined);
    }).toThrow('Expected an effect contract builder callback');
    // @ts-expect-error Exercise the same untyped value at the Playwright matcher boundary.
    const rejected = expect(effects).toSatisfy(undefined);
    await check(rejected).rejects.toThrow('Use toSatisfy((effects) => [...])');
  });
});
