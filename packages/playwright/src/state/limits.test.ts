import { expect, it } from 'vitest';
import { createStateRegistry } from './registry.js';
import { copyValue } from './value.js';

it('rejects values exceeding each copy limit without losing independent observations', async () => {
  const registry = createStateRegistry();
  let deep: unknown = 'leaf';
  for (let i = 0; i < 18; i++) {
    deep = { child: deep };
  }
  const many = Object.fromEntries(Array.from({ length: 10_001 }, (_, i) => [`k${i}`, i]));
  const large = Object.fromEntries(
    Array.from({ length: 64 }, (_, i) => [`k${i}`, 'x'.repeat(16_000)]),
  );
  expect(() => copyValue(large)).toThrow('exceeds limits');
  const safe = registry.state.observe('safe', { read: () => 'retained' });
  registry.state.observe('invalid', {
    string: () => 'x'.repeat(16_385),
    depth: () => deep,
    nodes: () => many,
    bytes: () => large,
  });
  const selection = registry.select();
  const captured = await selection.capture();
  expect(captured.failures).toEqual(
    ['string', 'depth', 'nodes', 'bytes'].map((reader) => ({
      observer: 'invalid',
      reader,
      reason: 'invalid-value',
    })),
  );
  expect(selection.initial(captured.checkpoint, safe)).toEqual({ read: 'retained' });
});

it('bounds the whole checkpoint and retains smaller readers after a rejected value', async () => {
  const registry = createStateRegistry();
  const part = Object.fromEntries(
    Array.from({ length: 40 }, (_, i) => [`k${i}`, 'x'.repeat(16_000)]),
  );
  registry.state.observe('first', { read: () => part });
  registry.state.observe('exceeds', { second: () => part });
  const good = registry.state.observe('good', { small: () => 'retained' });
  const selection = registry.select();
  const captured = await selection.capture();
  expect(captured.failures).toEqual([
    { observer: 'exceeds', reader: 'second', reason: 'invalid-value' },
  ]);
  expect(selection.initial(captured.checkpoint, good).small).toBe('retained');
});

it('rejects an in-flight capture after attempt cancellation without running later readers', async () => {
  const registry = createStateRegistry();
  let release: (value: string) => void = () => {
    throw new Error('reader did not start');
  };
  let laterReads = 0;
  registry.state.observe('payments', {
    pending: () =>
      new Promise<string>((resolve) => {
        release = resolve;
      }),
    later: () => {
      laterReads++;
      return 'later';
    },
  });
  const capture = registry.select().capture();
  registry.close();
  release('done');
  await expect(capture).rejects.toThrow('expired');
  expect(laterReads).toBe(0);
});
