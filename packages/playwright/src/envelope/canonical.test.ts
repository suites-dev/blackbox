import { describe, expect, it } from 'vitest';

import { canonicalize, digestBytes, digestOf } from './canonical.js';

describe('canonical serialization', () => {
  it('ignores key order and keeps array order', () => {
    expect(canonicalize({ b: 1, a: { d: [3, 1], c: 'x' } })).toBe(
      '{"a":{"c":"x","d":[3,1]},"b":1}',
    );
    expect(digestOf({ a: 1, b: 2 })).toBe(digestOf({ b: 2, a: 1 }));
    expect(digestOf([1, 2])).not.toBe(digestOf([2, 1]));
  });

  it('refuses what has no single serialization', () => {
    expect(() => canonicalize({ a: 1.5 })).toThrow(TypeError);
    expect(() => canonicalize({ a: undefined })).toThrow(TypeError);
    expect(() => canonicalize({ a: Number.NaN })).toThrow(TypeError);
    expect(() => canonicalize({ a: () => 1 })).toThrow(TypeError);
  });

  it('escapes like JSON and prefixes digests with the algorithm', () => {
    expect(canonicalize('é"\n')).toBe(JSON.stringify('é"\n'));
    expect(digestBytes('abc')).toBe(
      'sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});
