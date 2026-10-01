import { expect, test } from 'vitest';
import { validateShape } from './schema.js';

test('bundled string lengths count Unicode code points, not UTF-16 units', () => {
  const schema = { type: 'string', minLength: 2 };
  expect(validateShape('💡', schema)).toEqual([
    expect.objectContaining({ code: 'schema.invalid' }),
  ]);
  expect(validateShape('💡a', schema)).toEqual([]);
});

test('bounds array processing at 10000 items', () => {
  const schema = { type: 'array', items: { type: 'integer' } };
  expect(
    validateShape(
      Array.from({ length: 10000 }, () => 1),
      schema,
    ),
  ).toEqual([]);
  expect(
    validateShape(
      Array.from({ length: 10001 }, () => 1),
      schema,
    ),
  ).toEqual([expect.objectContaining({ code: 'schema.invalid' })]);
});

test('bounds recursive schema traversal instead of trusting arbitrarily deep input', () => {
  const schema = {
    $defs: {
      item: { oneOf: [{ type: 'integer' }, { type: 'array', items: { $ref: '#/$defs/item' } }] },
    },
    $ref: '#/$defs/item',
  };
  let value: unknown = 1;
  for (let level = 0; level < 65; level += 1) {
    value = [value];
  }
  expect(validateShape([[1]], schema)).toEqual([]);
  expect(validateShape(value, schema)).toEqual([
    expect.objectContaining({ code: 'schema.invalid' }),
  ]);
});

test('does not follow external schema references or accept unknown schema vocabulary', () => {
  expect(() => validateShape({}, { $ref: 'https://invalid.example/schema.json' })).toThrow(
    'Unsupported bundled schema reference',
  );
  expect(() => validateShape({}, { $defs: {}, $ref: '#/$defs/missing' })).toThrow(
    'Unknown bundled schema reference',
  );
  expect(() => validateShape(true, { type: 'boolean' })).toThrow('Unsupported bundled schema rule');
});

test('accepts only precompiled bundled patterns, rejecting arbitrary expressions', () => {
  const schema = { type: 'string', pattern: '^[a-f0-9]{64}$' };
  expect(validateShape('a'.repeat(64), schema)).toEqual([]);
  expect(validateShape('z'.repeat(64), schema)).toEqual([
    expect.objectContaining({ code: 'schema.invalid' }),
  ]);
  expect(() => validateShape('anything', { type: 'string', pattern: '.*' })).toThrow(
    'Unsupported bundled schema pattern',
  );
});
