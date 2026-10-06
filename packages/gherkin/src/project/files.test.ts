import { describe, expect, it } from 'vitest';

import { acceptedFeatures, globToRegExp } from './files.js';

// Requirements (task 2.4): project globs use only `*` and `**`, the subset the
// spec/code separation check uses; drafts are never accepted features, even
// when a feature glob matches them.

describe('project globs', () => {
  it('match `*` within one segment and `**` across segments, and nothing else as a wildcard', () => {
    const features = globToRegExp('features/**/*.feature');
    expect(['features/a.feature', 'features/x/y/b.feature'].every((path) => features.test(path))).toBe(true);
    expect(['features/a.feature.bak', 'other/features/a.feature', 'features/a.feature/x'].some((path) => features.test(path))).toBe(false);
    expect(globToRegExp('docs/[a].md').test('docs/[a].md')).toBe(true);
    expect(globToRegExp('docs/[a].md').test('docs/a.md')).toBe(false);
  });

  it('accept features that a feature glob matches and no drafts glob does', () => {
    const files = ['features/a.feature', 'features/drafts/b.feature', 'features/drafts/c/d.feature', 'notes.md'];
    expect(acceptedFeatures(files, { features: ['features/**/*.feature'], drafts: ['features/drafts/**'] })).toEqual([
      'features/a.feature',
    ]);
  });
});
