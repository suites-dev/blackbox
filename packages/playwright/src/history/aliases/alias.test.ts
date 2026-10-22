import { describe, expect, it } from 'vitest';

import { defined } from '../testing/history.fixture.js';
import { aliasPath, buildAlias, resolveAliases, verifyAlias, type AliasBody } from './alias.js';

const body = (from: string, to: string, reason = 'renamed'): AliasBody => ({
  aliasVersion: 1,
  kind: 'behavior-alias',
  canonicalization: 'bb-jcs-1',
  from,
  to,
  reason,
  assertedBy: 'reviewer',
  recordedAt: '2026-01-01T00:00:00.000Z',
  witnesses: { from: null, to: null },
});
const make = (...pairs: [string, string][]) =>
  pairs.map(([from, to]) => buildAlias(body(from, to)));

describe('behavior aliases', () => {
  it('verifies a well-formed alias and rejects self-pointing, empty reasons and changes', () => {
    expect(verifyAlias(buildAlias(body('a', 'b'))).ok).toBe(true);
    expect(verifyAlias(buildAlias(body('a', 'a'))).ok).toBe(false);
    expect(verifyAlias(buildAlias(body('a', 'b', '  '))).ok).toBe(false);
    expect(verifyAlias({ ...buildAlias(body('a', 'b')), to: 'c' }).ok).toBe(false);
  });

  it('resolves a chain to the newest id and lists every id it connects', () => {
    const resolution = resolveAliases(make(['old', 'mid'], ['mid', 'new']), 'old');
    expect(resolution).toEqual({ ids: ['mid', 'new', 'old'], current: 'new', conflicts: [] });
    expect(resolveAliases(make(['old', 'mid'], ['mid', 'new']), 'new').ids).toEqual([
      'mid',
      'new',
      'old',
    ]);
  });

  it('does nothing for an id with no recorded alias, however similar the names are', () => {
    const resolution = resolveAliases(
      make(['subscription.create', 'subscription.start']),
      'subscription.create2',
    );
    expect(resolution).toEqual({
      ids: ['subscription.create2'],
      current: 'subscription.create2',
      conflicts: [],
    });
  });

  it('reports two successors and cycles instead of choosing', () => {
    expect(resolveAliases(make(['a', 'b'], ['a', 'c']), 'a')).toMatchObject({
      current: null,
      conflicts: [expect.stringContaining('more than one successor')],
    });
    expect(resolveAliases(make(['a', 'b'], ['b', 'a']), 'a')).toMatchObject({
      current: null,
      conflicts: [expect.stringContaining('cycle')],
    });
  });

  it('returns the recorded aliases that connect two ids, or nothing when they are not connected', () => {
    const aliases = make(['old', 'mid'], ['mid', 'new']);
    expect(
      defined(aliasPath(aliases, 'old', 'new')).map(({ from, to }) => `${from}>${to}`),
    ).toEqual(['old>mid', 'mid>new']);
    expect(aliasPath(aliases, 'old', 'other')).toBeNull();
    expect(aliasPath(aliases, 'old', 'old')).toEqual([]);
  });
});
