import { describe, expect, it } from 'vitest';

import { canonicalDigest, sha256Hex } from './digest.js';
import { CanonicalJsonError, canonicalJson } from './jcs.js';

describe('RFC 8785 canonical JSON', () => {
  it('orders keys by UTF-16 code units, including non-ASCII and astral keys (RFC 8785 3.2.3)', () => {
    const input = {
      '\u20ac': 'Euro Sign',
      '\r': 'Carriage Return',
      '\ufb33': 'Hebrew Letter Dalet With Dagesh',
      '1': 'One',
      '\ud83d\ude00': 'Emoji: Grinning Face',
      '\u0080': 'Control',
      '\u00f6': 'Latin Small Letter O With Diaeresis',
    };
    // The emoji (lead surrogate U+D83D) sorts before U+FB33 by code unit even
    // though its code point (U+1F600) is larger; locale collation differs too.
    expect(canonicalJson(input)).toBe(
      '{"\\r":"Carriage Return","1":"One","\u0080":"Control",' +
        '"\u00f6":"Latin Small Letter O With Diaeresis","\u20ac":"Euro Sign",' +
        '"\ud83d\ude00":"Emoji: Grinning Face","\ufb33":"Hebrew Letter Dalet With Dagesh"}',
    );
  });

  it('escapes strings exactly as RFC 8785 3.2.2.2 requires', () => {
    const decoded = JSON.parse(
      String.raw`"\u20ac$\u000F\u000aA'\u0042\u0022\u005c\\\"\/"`,
    ) as string;
    expect(canonicalJson(decoded)).toBe(String.raw`"€$\u000f\nA'B\"\\\\\"/"`);
    expect(canonicalJson('\u0080\u2028\ud83d\ude00')).toBe('"\u0080\u2028\ud83d\ude00"');
  });

  it('serializes nested structures without whitespace and keeps array order', () => {
    expect(canonicalJson({ b: [3, 1, { d: null, c: true }], a: false, '': -0 })).toBe(
      '{"":0,"a":false,"b":[3,1,{"c":true,"d":null}]}',
    );
  });

  it.each([
    ['a fraction', 1.5],
    ['an unsafe integer', Number.MAX_SAFE_INTEGER + 1],
    ['infinity', Number.POSITIVE_INFINITY],
    ['NaN', Number.NaN],
  ])('throws on %s instead of emitting platform-formatted numbers', (_label, value) => {
    expect(() => canonicalJson({ value })).toThrow(CanonicalJsonError);
  });

  it.each([
    ['an unpaired lead surrogate', '\ud83d'],
    ['an unpaired trail surrogate', 'x\ude00'],
  ])('throws on %s', (_label, value) => {
    expect(() => canonicalJson([value])).toThrow(/unpaired surrogate/u);
    expect(() => canonicalJson({ [value]: 1 })).toThrow(/unpaired surrogate/u);
  });

  it.each([
    ['undefined', { value: undefined }],
    ['a bigint', { value: 1n }],
    ['a function', { value: () => 1 }],
    ['a date', { value: new Date(0) }],
    ['a map', { value: new Map() }],
  ])('throws on %s', (_label, value) => {
    expect(() => canonicalJson(value)).toThrow(CanonicalJsonError);
  });

  it('accepts null-prototype objects and hashes canonical bytes as UTF-8', () => {
    const value = Object.assign(Object.create(null) as object, { b: 1, a: '€' });
    expect(canonicalJson(value)).toBe('{"a":"€","b":1}');
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    expect(canonicalDigest({ b: 1, a: '€' })).toBe(`sha256:${sha256Hex('{"a":"€","b":1}')}`);
  });
});
