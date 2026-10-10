import { describe, expect, it } from 'vitest';

import { expectPointer, resolvePointer } from './json-pointer.js';

// Requirement (task 2.3, report section 6.2): state claims address members
// with JSON Pointer (RFC 6901). A pointer that names nothing is "not found",
// never undefined, so a claim cannot pass by comparing against nothing.

// The example document and pointers of RFC 6901 section 5.
const rfcDocument = {
  foo: ['bar', 'baz'],
  '': 0,
  'a/b': 1,
  'c%d': 2,
  'e^f': 3,
  'g|h': 4,
  'i\\j': 5,
  'k"l': 6,
  ' ': 7,
  'm~n': 8,
};

describe('resolvePointer', () => {
  it('resolves every RFC 6901 example', () => {
    const cases = [
      ['', rfcDocument],
      ['/foo', ['bar', 'baz']],
      ['/foo/0', 'bar'],
      ['/', 0],
      ['/a~1b', 1],
      ['/c%d', 2],
      ['/e^f', 3],
      ['/g|h', 4],
      ['/i\\j', 5],
      ['/k"l', 6],
      ['/ ', 7],
      ['/m~0n', 8],
    ] satisfies readonly (readonly [string, unknown])[];
    for (const [pointer, value] of cases) {
      expect(resolvePointer(rfcDocument, pointer), pointer).toEqual({ found: true, value });
    }
  });

  it('unescapes ~1 before ~0, so ~01 names the key "~1"', () => {
    expect(resolvePointer({ '~1': 'tilde-one', '/': 'slash' }, '/~01')).toEqual({
      found: true,
      value: 'tilde-one',
    });
  });

  it('reports members that do not exist as not found, including null and falsy values that do', () => {
    const document = { list: [0, null], empty: null, nested: { zero: 0 } };
    expect(resolvePointer(document, '/list/1')).toEqual({ found: true, value: null });
    expect(resolvePointer(document, '/empty')).toEqual({ found: true, value: null });
    expect(resolvePointer(document, '/nested/zero')).toEqual({ found: true, value: 0 });
    for (const pointer of [
      '/missing',
      '/list/2',
      '/list/-',
      '/list/01',
      '/list/x',
      '/empty/x',
      '/nested/zero/x',
    ]) {
      expect(resolvePointer(document, pointer), pointer).toEqual({ found: false });
    }
  });

  it('does not reach inherited members', () => {
    expect(resolvePointer({}, '/constructor')).toEqual({ found: false });
    expect(resolvePointer([], '/length')).toEqual({ found: false });
  });

  it('rejects text that is not a JSON Pointer', () => {
    for (const pointer of ['subscriptions', '/a~2', '/a~', '#/a']) {
      expect(() => resolvePointer({}, pointer), pointer).toThrow('Not a JSON Pointer');
      expect(() => {
        expectPointer(pointer);
      }, pointer).toThrow('JSON Pointer (RFC 6901)');
    }
    expect(() => {
      expectPointer('/subscriptions/0/id');
    }).not.toThrow();
  });
});
