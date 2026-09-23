import { describe, expect, it } from 'vitest';

import { renderRegistryPage, selectionQuery } from './registry-page.js';

describe('report registry UI', () => {
  it('renders accessible discovery controls and an exact-session report host', () => {
    const html = renderRegistryPage();
    expect(html).toContain('CAPSULE · EXPERIMENT REGISTRY');
    expect(html).toContain('aria-label="Filter by session state"');
    expect(html).toContain('id="search" type="search"');
    expect(html).toContain('sandbox="allow-scripts allow-downloads"');
    expect(html).toContain('Viewing a report never runs a command');
    expect(html).toContain("kind:'capsule-report-restore'");
    expect(html).not.toContain('allow-same-origin');
  });

  it('encodes an exact selection without changing registry routes', () => {
    expect(selectionQuery({ selection: { kind: 'registry' } })).toBe('');
    expect(selectionQuery({ selection: { kind: 'report', type: 'capsule', id: 'a/b & c' } }))
      .toBe('?type=capsule&id=a%2Fb+%26+c');
  });
});
