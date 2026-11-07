import { expect, it } from 'vitest';
import { createStateRegistry } from '../registry.js';
import type { JsonValue } from '../types.js';

function nested(depth: number, value: string): JsonValue {
  let result: JsonValue = value;
  for (let i = 0; i < depth; i++) {
    result = { child: result };
  }
  return result;
}

it('redacts credential-named scalar readers in complete and selected checkpoint reports', async () => {
  const registry = createStateRegistry();
  const observer = registry.state.observe('account', {
    password: () => 'synthetic-password-value',
    accessToken: () => 'synthetic-token-value',
    label: () => 'public-label',
  });
  const selection = registry.select();
  const first = await selection.capture();
  const last = await selection.capture();
  expect(selection.initial(first.checkpoint, observer).password).toBe('synthetic-password-value');
  for (const serialized of [
    selection.serialize(first.checkpoint, (value) => value),
    selection.serializeObserver(first.checkpoint, observer, (value) => value),
  ]) {
    expect(serialized.observers[0].readers).toEqual([
      { name: 'password', status: 'captured', value: '[REDACTED]' },
      { name: 'accessToken', status: 'captured', value: '[REDACTED]' },
      { name: 'label', status: 'captured', value: 'public-label' },
    ]);
    expect(JSON.stringify(serialized)).not.toContain('synthetic-');
  }
  expect(
    selection.serializeBetween(first.checkpoint, last.checkpoint, (value) => value),
  ).toMatchObject({ observers: [{ diff: { password: '[REDACTED]', accessToken: '[REDACTED]' } }] });
});

it('serializes depth-16 scalar and row values with their checkpoint and diff wrappers', async () => {
  const registry = createStateRegistry();
  let scalar = nested(16, 'before');
  let rows = [{ id: 'one', data: nested(14, 'before') }];
  registry.state.observe('deep', { scalar: () => scalar, rows: () => rows });
  const selection = registry.select();
  const first = await selection.capture();
  scalar = nested(16, 'after');
  rows = [{ id: 'one', data: nested(14, 'after') }];
  const last = await selection.capture();
  expect([first.failures, last.failures]).toEqual([[], []]);
  expect(selection.serialize(first.checkpoint, (value) => value).observers[0].readers).toEqual([
    { name: 'scalar', status: 'captured', value: nested(16, 'before') },
    { name: 'rows', status: 'captured', value: [{ id: 'one', data: nested(14, 'before') }] },
  ]);
  expect(
    selection.serializeBetween(first.checkpoint, last.checkpoint, (value) => value),
  ).toMatchObject({
    observers: [
      {
        diff: {
          scalar: { before: nested(16, 'before'), after: scalar, changed: true },
          rows: {
            added: [],
            removed: [],
            changed: [
              {
                before: { id: 'one', data: nested(14, 'before') },
                after: rows[0],
              },
            ],
          },
        },
      },
    ],
  });
});

it('serializes aggregate reader nodes and both admitted cuts under the envelope budget', async () => {
  const registry = createStateRegistry();
  const values = Object.fromEntries(Array.from({ length: 6_000 }, (_, i) => [`k${i}`, i]));
  const large = Object.fromEntries(
    Array.from({ length: 40 }, (_, i) => [`k${i}`, 'x'.repeat(16_000)]),
  );
  registry.state.observe('values', {
    first: () => values,
    second: () => values,
    large: () => large,
  });
  const selection = registry.select();
  const first = await selection.capture();
  const last = await selection.capture();
  expect([first.failures, last.failures]).toEqual([[], []]);
  expect(selection.serialize(first.checkpoint, (value) => value).observers[0].readers).toEqual([
    { name: 'first', status: 'captured', value: values },
    { name: 'second', status: 'captured', value: values },
    { name: 'large', status: 'captured', value: large },
  ]);
  expect(
    selection.serializeBetween(first.checkpoint, last.checkpoint, (value) => value),
  ).toMatchObject({
    observers: [
      {
        diff: {
          first: { before: values, after: values, changed: false },
          second: { before: values, after: values, changed: false },
          large: { before: large, after: large, changed: false },
        },
      },
    ],
  });
});

it('rejects aggregate serialized envelopes expanded beyond their separate byte budget', async () => {
  const registry = createStateRegistry();
  const values = Object.fromEntries(Array.from({ length: 600 }, (_, i) => [`k${i}`, 'expand']));
  registry.state.observe('values', { read: () => values });
  const selection = registry.select();
  const first = await selection.capture();
  const last = await selection.capture();
  const redact = (value: string) => (value === 'expand' ? 'x'.repeat(16_000) : value);
  expect(first.failures).toEqual([]);
  expect(() => selection.serialize(first.checkpoint, redact)).toThrow(
    'Serialized state evidence exceeds limits',
  );
  expect(() => selection.serializeBetween(first.checkpoint, last.checkpoint, redact)).toThrow(
    'Serialized state evidence exceeds limits',
  );
});
