import { Ajv2020 } from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';

import { normalizeEffects } from '../normalize.js';
import { effectInput, request, span, traceA } from '../testing/otlp.js';
import { effectSetSchema } from './index.js';

const validate = new Ajv2020({ strict: true, allErrors: true }).compile(effectSetSchema);
const set = normalizeEffects(
  effectInput([
    {
      sequence: 1,
      request: request('api', [
        span({ traceId: traceA, spanId: 'aaaaaaaaaaaaaaaa', name: 'op', kind: 1, attributes: [] }),
      ]),
    },
  ]),
);
const [effect] = set.effects;

describe('effect-set-v1 schema', () => {
  it('accepts a normalized effect set', () => {
    expect(validate(set)).toBe(true);
  });

  it.each([
    ['an unknown top-level field', { ...set, extra: true }],
    ['a missing header', { ...set, normalizer: undefined }],
    ['another schema version', { ...set, schemaVersion: 2 }],
    ['a malformed input digest', { ...set, inputs: [{ ...set.inputs[0], sha256: 'abc' }] }],
    ['an unknown effect kind', { ...set, effects: [{ ...effect, kind: 'db' }] }],
    ['a malformed effect id', { ...set, effects: [{ ...effect, id: 'e_XYZ' }] }],
    ['a zero count', { ...set, effects: [{ ...effect, count: 0 }] }],
    [
      'an occurrence without deliveries',
      {
        ...set,
        effects: [{ ...effect, occurrences: [{ ...effect.occurrences[0], deliveries: [] }] }],
      },
    ],
    [
      'provisional completeness without reasons',
      { ...set, completeness: { kind: 'provisional', reasons: [] } },
    ],
  ])('rejects %s', (_label, value) => {
    expect(validate(value)).toBe(false);
  });
});
