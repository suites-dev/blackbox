import { expect, test } from 'vitest';
import { createEffectCapture } from '../create.js';
import { serializeEffectSnapshot } from './serialize.js';
import { capture, effect, identity } from '../test-fixtures/capture.js';

test('snapshot retains observed multiplicity and explicit incomplete coverage in readable YAML', () => {
  const recorder = capture([effect('one', 'INSERT'), effect('two', 'INSERT')], {
    scope: { id: 'fixture', closed: false },
  }).db({ operation: 'INSERT' });
  expect(
    serializeEffectSnapshot(recorder, {
      project: (emission) => ({ operation: emission.operation, target: emission.target }),
    }),
  ).toBe(
    [
      '"availability":',
      '  "available": true',
      '  "reason": null',
      '"coverage":',
      '  "attestation": "internal-test-only"',
      '  "closed": false',
      '  "coverage": "complete"',
      '  "orderCoverage": "complete"',
      '  "reasons": []',
      '"emissions":',
      '  -',
      '    "count": 2',
      '    "value":',
      '      "operation": "INSERT"',
      '      "target": "orders"',
      '"kind": "recorded-effect-observations"',
      '"possibleEmissions": []',
      '"schemaVersion": 1',
      '"selector":',
      '  "kind": "db"',
      '  "node": "selector"',
      '  "operation": "INSERT"',
      '',
    ].join('\n'),
  );
});

test('explicit normalization yields stable snapshots across identities and ingestion permutations', () => {
  const left = capture([effect('one', 'INSERT', { target: 'orders-1' }), effect('two', 'UPDATE')]);
  const right = capture([
    effect('different', 'UPDATE'),
    effect('later', 'INSERT', { target: 'orders-2' }),
  ]);
  const options = {
    project: (emission: { readonly target: string; readonly operation: string }) => ({
      target: emission.target,
      operation: emission.operation,
    }),
    normalize: () => ({ operation: 'normalized', target: 'orders' }),
  };
  expect(serializeEffectSnapshot(left.db(), options)).toBe(
    serializeEffectSnapshot(right.db(), options),
  );
  expect(serializeEffectSnapshot(left.db(), options)).toContain('"count": 2');
  expect(serializeEffectSnapshot(left.db(), options)).not.toContain('cut-1');
});

test('possible selections remain separate from witnessed emissions', () => {
  const recorder = capture([effect('known', 'INSERT'), effect('maybe', 'unknown')]).db({
    operation: 'INSERT',
  });
  const output = serializeEffectSnapshot(recorder, { project: (emission) => emission.operation });
  expect(output).toContain('"emissions":\n  -\n    "count": 1\n    "value": "INSERT"');
  expect(output).toContain('"possibleEmissions":\n  -\n    "count": 1\n    "value": "unknown"');
});

test('quoted YAML preserves ambiguous strings and prevents injected mapping lines', () => {
  const recorder = capture([effect('one', 'INSERT')]).db();
  const output = serializeEffectSnapshot(recorder, {
    project: () => ({
      null: 'yes',
      injection: '\nadmin: true\n# comment',
      date: '2026-11-06',
      value: '0123',
    }),
  });
  expect(output).toContain('"null": "yes"');
  expect(output).toContain('"date": "2026-11-06"');
  expect(output).toContain('"value": "0123"');
  expect(output).toContain('"injection": "\\nadmin: true\\n# comment"');
  expect(output.split('\n')).not.toContain('admin: true');
});

test('missing observation cannot become an accepted empty baseline', () => {
  const unavailable = createEffectCapture({
    identity,
    unavailable: { reason: 'collector missing' },
  });
  expect(() => serializeEffectSnapshot(unavailable.db(), { project: () => null })).toThrow(
    'Cannot snapshot unavailable effects',
  );
});

test('snapshot projection rejects accessors, cycles, non-JSON and unbounded data', () => {
  const recorder = capture([effect('one', 'INSERT')]).db();
  const cycle: Record<string, unknown> = {};
  cycle.self = cycle;
  const accessor = {
    get secret(): string {
      throw new Error('accessor must not run');
    },
  };
  expect(() => serializeEffectSnapshot(recorder, { project: () => accessor })).toThrow(
    'inert JSON',
  );
  expect(() => serializeEffectSnapshot(recorder, { project: () => NaN })).toThrow('finite JSON');
  // @ts-expect-error Runtime validates an untyped projection at the public boundary.
  expect(() => serializeEffectSnapshot(recorder, { project: () => cycle })).toThrow('cycles');
  expect(() => serializeEffectSnapshot(recorder, { project: () => 'x'.repeat(1_048_577) })).toThrow(
    'one MiB',
  );
  expect(() =>
    serializeEffectSnapshot(recorder, { project: () => Array(10_001).fill(null) }),
  ).toThrow('10000');
});
