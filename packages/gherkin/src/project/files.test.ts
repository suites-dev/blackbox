import { describe, expect, it } from 'vitest';

import { acceptedFeatures, globToRegExp } from './files.js';

// Requirements (task 2.4): project globs use only `*` and `**`.

describe('project globs', () => {
  it('match `*` within one segment and `**` across segments, and nothing else as a wildcard', () => {
    const features = globToRegExp('features/**/*.feature');
    expect(['features/a.feature', 'features/x/y/b.feature'].every((path) => features.test(path))).toBe(true);
    expect(['features/a.feature.bak', 'other/features/a.feature', 'features/a.feature/x'].some((path) => features.test(path))).toBe(false);
    expect(globToRegExp('docs/[a].md').test('docs/[a].md')).toBe(true);
    expect(globToRegExp('docs/[a].md').test('docs/a.md')).toBe(false);
  });

  it('accept the features that a feature glob matches', () => {
    const files = ['features/a.feature', 'features/b/c.feature', 'other/d.feature', 'notes.md'];
    expect(acceptedFeatures(files, { features: ['features/**/*.feature'] })).toEqual(['features/a.feature', 'features/b/c.feature']);
  });
});
