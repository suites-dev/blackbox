import { expect as vitestExpect, it, vi } from 'vitest';

import type { EffectContract } from './contract.js';
import { expect } from './expect.js';
import { createBlackboxEffects, createUnavailableBlackboxEffects } from './runtime.js';

it('delegates a compiled contract to the evaluator owned by the attempt', async () => {
  const evaluate = vi.fn<(contract: EffectContract) => Promise<{ readonly kind: 'satisfied' }>>(
    () => Promise.resolve({ kind: 'satisfied' }),
  );
  const effects = createBlackboxEffects({
    sessionId: 'session-1',
    executionId: 'execution-1',
    evaluator: { evaluate },
  });

  await expect(effects).toSatisfy((contract) => [
    contract.exactly(1, contract.http({ method: 'POST', route: '/orders' })),
  ]);

  vitestExpect(evaluate).toHaveBeenCalledOnce();
  vitestExpect(evaluate).toHaveBeenCalledWith(
    vitestExpect.objectContaining({
      schemaVersion: 1,
      constraints: [
        {
          node: 'constraint',
          operator: 'exactly',
          count: 1,
          selector: {
            node: 'selector',
            kind: 'http',
            operation: 'POST',
            target: '/orders',
          },
        },
      ],
    }),
  );
});

it('rejects matcher negation when the evaluator conclusively satisfies the contract', async () => {
  const effects = createBlackboxEffects({
    sessionId: 'session-1',
    executionId: 'execution-1',
    evaluator: { evaluate: () => Promise.resolve({ kind: 'satisfied' }) },
  });

  await vitestExpect(
    expect(effects).not.toSatisfy((contract) => [contract.exists(contract.http())]),
  ).rejects.toThrow('Expected the effects contract not to be satisfied');
});

it('fails explicitly when no effect projector is configured', async () => {
  const effects = createUnavailableBlackboxEffects({
    sessionId: 'session-1',
    executionId: 'execution-1',
  });

  await vitestExpect(
    expect(effects).toSatisfy((contract) => [contract.exists(contract.http())]),
  ).rejects.toThrow('Effect projection is not available');
});

it('does not let matcher negation turn an unavailable effect projection into success', async () => {
  const effects = createUnavailableBlackboxEffects({
    sessionId: 'session-1',
    executionId: 'execution-1',
  });

  await vitestExpect(
    expect(effects).not.toSatisfy((contract) => [contract.exists(contract.http())]),
  ).rejects.toThrow('Effect projection is not available');
});

it('does not let matcher negation accept an effects handle from outside the attempt', async () => {
  const foreignEffects = Object.freeze({
    sessionId: 'foreign-session',
    executionId: 'foreign-execution',
  });

  await vitestExpect(
    expect(foreignEffects).not.toSatisfy((contract) => [contract.exists(contract.http())]),
  ).rejects.toThrow('not an effects fixture owned by this Playwright attempt');
});

it('surfaces an evaluator rejection as a failed matcher', async () => {
  const effects = createBlackboxEffects({
    sessionId: 'session-1',
    executionId: 'execution-1',
    evaluator: {
      evaluate: () => Promise.resolve({ kind: 'unsatisfied', message: 'missing queue send' }),
    },
  });

  await vitestExpect(
    expect(effects).toSatisfy((contract) => [contract.exists(contract.message())]),
  ).rejects.toThrow('missing queue send');
});

it('allows matcher negation when the evaluator conclusively rejects the contract', async () => {
  const effects = createBlackboxEffects({
    sessionId: 'session-1',
    executionId: 'execution-1',
    evaluator: {
      evaluate: () => Promise.resolve({ kind: 'unsatisfied', message: 'missing queue send' }),
    },
  });

  await expect(effects).not.toSatisfy((contract) => [contract.exists(contract.message())]);
});
