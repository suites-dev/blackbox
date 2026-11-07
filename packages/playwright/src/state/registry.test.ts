import { expect, it } from 'vitest';
import { createStateRegistry } from './registry.js';

it('registers without reads, freezes independent cuts and derives row and scalar diffs', async () => {
  const registry = createStateRegistry();
  let reads = 0;
  const rows = [{ id: 'one', status: 'new' }];
  let cached: string | null = null;
  const observer = registry.state.observe('payments', {
    rows: () => {
      reads++;
      return rows;
    },
    cached: () => cached,
  });
  expect(reads).toBe(0);
  const selection = registry.select();
  const first = await selection.capture();
  rows[0].status = 'paid';
  rows.push({ id: 'two', status: 'paid' });
  cached = 'one';
  const second = await selection.capture();
  const observed = selection.between(first.checkpoint, second.checkpoint, observer);
  expect(observed.initial.rows).toEqual([{ id: 'one', status: 'new' }]);
  expect(observed.diff.rows).toEqual({
    added: [{ id: 'two', status: 'paid' }],
    removed: [],
    changed: [{ before: { id: 'one', status: 'new' }, after: { id: 'one', status: 'paid' } }],
  });
  expect(observed.diff.cached).toEqual({ before: null, after: 'one', changed: true });
  expect(() => {
    (observed.initial.rows[0] as { status: string }).status = 'tampered';
  }).toThrow();
  expect(selection.initial(first.checkpoint, observer).rows[0].status).toBe('new');
  expect(reads).toBe(2);
  rows.shift();
  const third = await selection.capture();
  const later = selection.between(second.checkpoint, third.checkpoint, observer);
  expect(later.diff.rows).toEqual({
    added: [],
    removed: [{ id: 'one', status: 'paid' }],
    changed: [],
  });
  expect(later.diff.cached).toEqual({ before: 'one', after: 'one', changed: false });
});
it('rejects missing and duplicate row IDs and preserves independent successful readers', async () => {
  const registry = createStateRegistry();
  const observer = registry.state.observe('payments', {
    missing: () => [{ status: 'paid' }],
    duplicate: () => [{ id: 'one' }, { id: 'one' }],
    cache: () => 'ok',
  });
  const selection = registry.select();
  const capture = await selection.capture();
  expect(capture.failures).toEqual([
    { observer: 'payments', reader: 'missing', reason: 'missing-id' },
    { observer: 'payments', reader: 'duplicate', reason: 'duplicate-id' },
  ]);
  expect(() => selection.initial(capture.checkpoint, observer)).toThrow('capture failed');
  expect(selection.serialize(capture.checkpoint, (value) => value).observers[0].readers).toEqual([
    { name: 'missing', status: 'failed' },
    { name: 'duplicate', status: 'failed' },
    { name: 'cache', status: 'captured', value: 'ok' },
  ]);
});
it('rejects foreign, late and expired handles and foreign checkpoints', async () => {
  const a = createStateRegistry();
  const own = a.state.observe('one', { value: () => 1 });
  const selection = a.select();
  const late = a.state.observe('late', { value: () => 2 });
  const b = createStateRegistry();
  const foreign = b.state.observe('one', { value: () => 3 });
  const other = b.select();
  const first = await selection.capture();
  const second = await other.capture();
  expect(() => selection.initial(first.checkpoint, late)).toThrow('foreign');
  expect(() => selection.initial(first.checkpoint, foreign)).toThrow('foreign');
  expect(() => selection.initial(second.checkpoint, own)).toThrow('foreign');
  a.close();
  expect(() => selection.initial(first.checkpoint, own)).toThrow('expired');
  await expect(selection.capture()).rejects.toThrow('expired');
});
it('redacts serialized values and hides reader errors while bounding invalid inputs', async () => {
  const registry = createStateRegistry();
  registry.state.observe('payments', {
    good: () => ({ password: 'hunter2', note: 'synthetic-secret' }),
    bad: () => {
      throw new Error('synthetic-secret');
    },
    huge: () => 'x'.repeat(20_000),
  });
  const selection = registry.select();
  const captured = await selection.capture();
  const output = JSON.stringify(
    selection.serialize(captured.checkpoint, (value) =>
      value.replaceAll('synthetic-secret', '[REDACTED]'),
    ),
  );
  expect(output).not.toContain('hunter2');
  expect(output).not.toContain('synthetic-secret');
  expect(captured.failures.map((failure) => failure.reason)).toEqual([
    'reader-failed',
    'invalid-value',
  ]);
  expect(() =>
    selection.serialize(captured.checkpoint, () => {
      throw new Error('redaction failed');
    }),
  ).toThrow('redaction failed');
});

it('serializes each observer independently with checkpoint-linked diffs', async () => {
  const registry = createStateRegistry();
  let cache = 'one';
  const good = registry.state.observe('good', { cache: () => cache });
  registry.state.observe('bad', {
    cache: () => {
      throw new Error('secret');
    },
  });
  const selection = registry.select();
  const before = await selection.capture();
  cache = 'two';
  const after = await selection.capture();
  expect(selection.serializeObserver(before.checkpoint, good, (value) => value)).toMatchObject({
    checkpointId: before.checkpoint.id,
    failureCount: 0,
    observers: [{ name: 'good' }],
  });
  expect(
    selection.serializeBetweenObserver(before.checkpoint, after.checkpoint, good, (value) => value),
  ).toEqual({
    version: 1,
    initialCheckpointId: before.checkpoint.id,
    finalCheckpointId: after.checkpoint.id,
    observers: [
      {
        name: 'good',
        status: 'captured',
        diff: { cache: { before: 'one', after: 'two', changed: true } },
      },
    ],
  });
  expect(
    selection.serializeBetween(before.checkpoint, after.checkpoint, (value) => value).observers[1],
  ).toEqual({ name: 'bad', status: 'failed' });
});

it('rejects proxy and accessor values without invoking their traps', async () => {
  let traps = 0;
  const proxy = new Proxy(
    { id: 'one' },
    {
      get() {
        traps++;
        throw new Error('get trap');
      },
      getPrototypeOf() {
        traps++;
        throw new Error('prototype trap');
      },
      ownKeys() {
        traps++;
        throw new Error('keys trap');
      },
    },
  );
  const accessor = Object.defineProperty({}, 'then', {
    enumerable: true,
    get() {
      traps++;
      throw new Error('getter');
    },
  });
  const revoked = Proxy.revocable({}, {});
  revoked.revoke();
  const registry = createStateRegistry();
  registry.state.observe('payments', {
    direct: () => proxy,
    nested: () => ({ value: proxy }),
    accessor: () => accessor,
    revoked: () => revoked.proxy,
    normal: () => Promise.resolve('ok'),
  });
  const selection = registry.select();
  const captured = await selection.capture();
  expect(traps).toBe(0);
  expect(captured.failures).toEqual([
    { observer: 'payments', reader: 'direct', reason: 'invalid-value' },
    { observer: 'payments', reader: 'nested', reason: 'invalid-value' },
    { observer: 'payments', reader: 'accessor', reason: 'invalid-value' },
    { observer: 'payments', reader: 'revoked', reason: 'invalid-value' },
  ]);
  expect(
    selection.serialize(captured.checkpoint, (value) => value).observers[0].readers[4],
  ).toEqual({ name: 'normal', status: 'captured', value: 'ok' });
});
