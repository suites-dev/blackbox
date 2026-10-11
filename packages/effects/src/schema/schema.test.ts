import { readFileSync } from 'node:fs';

import { Ajv2020 } from 'ajv/dist/2020.js';
import { describe, expect, test } from 'vitest';

import { createEffectsRecord } from '../record/create.js';
import { serializeEffectsRecord } from '../record/serialize.js';
import { EFFECT_KINDS } from '../record/types.js';

const schema = JSON.parse(
  readFileSync(new URL('effects-record-v0.json', import.meta.url), 'utf8'),
) as {
  properties: { effects: { items: { properties: { kind: { enum: string[] } } } } };
};

const validate = new Ajv2020({ strict: true, allErrors: true }).compile(schema);

function document(
  completeness: Parameters<typeof createEffectsRecord>[0]['completeness'],
  effects: Parameters<typeof createEffectsRecord>[0]['effects'] = [],
): Record<string, unknown> {
  const record = createEffectsRecord({
    source: { kind: 'capsule-activity', id: 'a-1' },
    completeness,
    effects,
  });
  return JSON.parse(serializeEffectsRecord(record)) as Record<string, unknown>;
}

describe('effects record schema v0', () => {
  test.each([
    [
      'complete with an effect',
      { status: 'complete' } as const,
      [{ kind: 'http', operation: 'GET', target: '/h', outcome: '200', count: 2 } as const],
    ],
    ['provisional with no effects', { status: 'provisional' } as const, []],
    [
      'incomplete with a reason',
      { status: 'incomplete', reason: 'collector interrupted' } as const,
      [],
    ],
  ])('accepts what the builder produces: %s', (_name, completeness, effects) => {
    const accepted = document(completeness, effects);
    expect(validate(accepted), JSON.stringify(validate.errors)).toBe(true);
  });

  test('lists exactly the effect kinds the code lists', () => {
    expect(schema.properties.effects.items.properties.kind.enum).toEqual([...EFFECT_KINDS]);
  });

  test('rejects a count below one', () => {
    const bad = document({ status: 'complete' }, [
      { kind: 'db', operation: 'SELECT', target: 't', outcome: 'ok', count: 1 },
    ]);
    (bad.effects as { count: number }[])[0].count = 0;
    expect(validate(bad)).toBe(false);
  });

  test.each([
    ['at the top level', (d: Record<string, unknown>) => ({ ...d, statement: 'SELECT 1' })],
    [
      'inside source',
      (d: Record<string, unknown>) => ({ ...d, source: { ...(d.source as object), secret: 's' } }),
    ],
    [
      'inside an effect',
      (d: Record<string, unknown>) => ({
        ...d,
        effects: [{ ...(d.effects as object[])[0], statement: 'SELECT 1' }],
      }),
    ],
  ])('rejects an unknown field %s, so a secret cannot ride along unnoticed', (_where, mutate) => {
    const base = document({ status: 'complete' }, [
      { kind: 'db', operation: 'SELECT', target: 't', outcome: 'ok', count: 1 },
    ]);
    expect(validate(mutate(base))).toBe(false);
  });

  test('rejects an incomplete status that gives no reason', () => {
    const bad = { ...document({ status: 'complete' }), completeness: { status: 'incomplete' } };
    expect(validate(bad)).toBe(false);
  });

  test('rejects a reason on a complete status', () => {
    const bad = {
      ...document({ status: 'complete' }),
      completeness: { status: 'complete', reason: 'x' },
    };
    expect(validate(bad)).toBe(false);
  });
});
