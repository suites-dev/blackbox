import { describe, expect, it } from 'vitest';

import { InvalidEffectInputError } from './model/errors.js';
import { defaultEffectView, normalizeEffects, normalizeEffectsWith } from './normalize.js';
import { builtInRuleset, rulesetDigest } from './rules/ruleset.js';
import { effectInput, request, span, traceA } from './testing/otlp.js';

const input = effectInput([
  {
    sequence: 1,
    request: request('api', [
      span({ traceId: traceA, spanId: 'aaaaaaaaaaaaaaaa', name: 'op', kind: 1, attributes: [] }),
    ]),
  },
]);

describe('normalizeEffects', () => {
  it('records the normalizer version, ruleset digest, scope and fragment identities', () => {
    const set = normalizeEffects(input);
    expect(set.normalizer).toEqual({
      version: '0.1.0',
      rulesetDigest: rulesetDigest(builtInRuleset),
    });
    expect(set.scope).toEqual({
      kind: 'capsule-session',
      sessionId: 'test-session',
      activities: [],
    });
    expect(set.inputs.map(({ sequence }) => sequence)).toEqual([1]);
    expect(set.completeness).toEqual({
      kind: 'provisional',
      reasons: ['capture-facts-unavailable', 'policy-unavailable'],
    });
    expect(defaultEffectView(set)).toEqual(set.effects);
  });

  it('records which rule produced each occurrence and hashes the ruleset it used', () => {
    const custom = {
      version: 2,
      fallback: { id: 'fallback.custom', kind: 'unclassified' },
    } as const;
    const set = normalizeEffectsWith(custom, input);
    expect(set.normalizer.rulesetDigest).not.toBe(rulesetDigest(builtInRuleset));
    expect(set.effects[0].occurrences[0].matched.classification).toBe('fallback.custom');
  });

  it('derives effect ids from identity, not from span ids or fragment sequences', () => {
    const moved = effectInput([
      {
        sequence: 4,
        request: request('api', [
          span({
            traceId: traceA,
            spanId: 'cccccccccccccccc',
            name: 'op',
            kind: 1,
            attributes: [],
          }),
        ]),
      },
    ]);
    expect(normalizeEffects(moved).effects[0].id).toBe(normalizeEffects(input).effects[0].id);
  });

  it('rejects an input without a session scope', () => {
    expect(() =>
      normalizeEffects({ ...input, scope: { kind: 'capsule-session', sessionId: '' } }),
    ).toThrow(InvalidEffectInputError);
  });
});
