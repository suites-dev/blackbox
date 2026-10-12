import { describe, expect, test } from 'vitest';

import type { Effect, EffectsRecordInput } from './types.js';

import { createEffectsRecord } from './create.js';
import { serializeEffectsRecord } from './serialize.js';

const select = {
  kind: 'db',
  operation: 'SELECT',
  target: 'users',
  outcome: 'ok',
  count: 1,
} satisfies Effect;
const insert = {
  kind: 'db',
  operation: 'INSERT',
  target: 'orders',
  outcome: 'ok',
  count: 1,
} satisfies Effect;
const get = {
  kind: 'http',
  operation: 'GET',
  target: '/health',
  outcome: '200',
  count: 1,
} satisfies Effect;

function input(effects: readonly Effect[]): EffectsRecordInput {
  return {
    source: { kind: 'playwright-attempt', id: 'attempt-1' },
    completeness: { status: 'complete' },
    effects,
  };
}

describe('createEffectsRecord: effects', () => {
  test('adds the counts of equal effects into one effect', () => {
    const record = createEffectsRecord(input([select, select, { ...select, count: 2 }]));
    expect(record.effects).toEqual([{ ...select, count: 4 }]);
  });

  test('keeps effects that differ in any field apart', () => {
    const record = createEffectsRecord(
      input([
        select,
        { ...select, outcome: 'error' },
        { ...select, target: 'orders' },
        { ...select, operation: 'DELETE' },
        { ...select, kind: 'cache' },
      ]),
    );
    expect(record.effects).toHaveLength(5);
  });

  test('puts the effects in one fixed order whatever the input order', () => {
    const forward = createEffectsRecord(input([get, insert, select])).effects;
    const reversed = createEffectsRecord(input([select, insert, get])).effects;
    expect(reversed).toEqual(forward);
    expect(forward.map((effect) => effect.operation)).toEqual(['INSERT', 'SELECT', 'GET']);
  });

  test('one more query is exactly one more count, and nothing else changes', () => {
    const before = createEffectsRecord(input([select, get]));
    const after = createEffectsRecord(input([select, select, get]));
    expect(after.effects).toEqual([{ ...select, count: 2 }, get]);
    expect(before.effects).toEqual([select, get]);
  });

  test.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
    'rejects the count %s',
    (count) => {
      expect(() => createEffectsRecord(input([{ ...select, count }]))).toThrow(RangeError);
    },
  );

  test('rejects a merged count that is no longer exact', () => {
    const big = { ...select, count: Number.MAX_SAFE_INTEGER };
    expect(() => createEffectsRecord(input([big, select]))).toThrow(RangeError);
  });

  test.each(['operation', 'target', 'outcome'] as const)(
    'rejects a %s that is not a string, so the record always matches its schema',
    (field) => {
      for (const value of [undefined, 1, null, {}]) {
        const bad: Effect = JSON.parse(JSON.stringify({ ...select, [field]: value }));
        expect(() => createEffectsRecord(input([bad]))).toThrow(TypeError);
      }
    },
  );

  test('accepts an empty string for operation, target and outcome', () => {
    const record = createEffectsRecord(input([{ ...select, target: '', outcome: '' }]));
    expect(record.effects).toHaveLength(1);
  });

  test('rejects an unknown effect kind', () => {
    const unknown: Effect = JSON.parse(JSON.stringify({ ...select, kind: 'zzz' }));
    expect(() => createEffectsRecord(input([unknown]))).toThrow(TypeError);
  });
});

describe('createEffectsRecord: source and completeness', () => {
  test('rejects an empty source id and an unknown source kind', () => {
    const empty = { ...input([]), source: { kind: 'capsule-activity', id: '' } } as const;
    expect(() => createEffectsRecord(empty)).toThrow(TypeError);
    const unknown = { ...input([]), source: { kind: 'other', id: 'x' } } as unknown;
    expect(() => createEffectsRecord(unknown as EffectsRecordInput)).toThrow(TypeError);
  });

  test('rejects an incomplete record that gives no reason', () => {
    const bad = { ...input([]), completeness: { status: 'incomplete', reason: '' } } as const;
    expect(() => createEffectsRecord(bad)).toThrow(TypeError);
  });

  test('keeps an incomplete record incomplete, with its reason and no effects invented', () => {
    const record = createEffectsRecord({
      ...input([]),
      completeness: { status: 'incomplete', reason: 'collector interrupted' },
    });
    expect(record.effects).toEqual([]);
    expect(record.completeness).toEqual({ status: 'incomplete', reason: 'collector interrupted' });
  });

  test('copies source and completeness: extra fields are dropped and later mutation is not seen', () => {
    const source = { kind: 'capsule-activity', id: 'a-1', secret: 's' } as const;
    const record = createEffectsRecord({ ...input([]), source });
    expect(record.source).toEqual({ kind: 'capsule-activity', id: 'a-1' });
    expect(record.source).not.toBe(source);
    const completeness = { status: 'provisional', note: 'x' } as unknown;
    const provisional = createEffectsRecord({
      ...input([]),
      completeness: completeness as EffectsRecordInput['completeness'],
    });
    expect(provisional.completeness).toEqual({ status: 'provisional' });
  });
});

describe('serializeEffectsRecord', () => {
  test('gives the same bytes for the same logical record, whatever key order the caller used', () => {
    const reordered = {
      effects: [{ count: 1, outcome: 'ok', target: 'users', operation: 'SELECT', kind: 'db' }],
      completeness: { status: 'complete' },
      source: { id: 'attempt-1', kind: 'playwright-attempt' },
    } as EffectsRecordInput;
    const left = serializeEffectsRecord(createEffectsRecord(reordered));
    const right = serializeEffectsRecord(createEffectsRecord(input([select])));
    expect(left).toBe(right);
  });

  test('writes two-space indented JSON with a final newline and a fixed key order', () => {
    const text = serializeEffectsRecord(createEffectsRecord(input([select])));
    expect(text.endsWith('}\n')).toBe(true);
    expect(text.startsWith('{\n  "schemaVersion": 0,\n  "source": {\n    "kind"')).toBe(true);
    expect(Object.keys(JSON.parse(text) as object)).toEqual([
      'schemaVersion',
      'source',
      'completeness',
      'effects',
    ]);
  });
});
