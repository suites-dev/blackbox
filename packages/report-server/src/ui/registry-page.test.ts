import { describe, expect, it } from 'vitest';

import { renderRegistryPage, selectionQuery } from './registry-page.js';
import { fixtureProvider } from '../test-fixtures/provider.js';

describe('report registry UI', () => {
  it('renders accessible discovery controls and an exact-session report host', () => {
    const html = renderRegistryPage({ providers: [fixtureProvider().provider] });
    expect(html).toContain('CAPSULE · EXPERIMENT REGISTRY');
    expect(html).toContain('aria-label="Filter by session state"');
    expect(html).toContain('id="search" type="search"');
    expect(html).toContain('id="registry-view"');
    expect(html).toContain('id="report-view" class="detail" aria-label="Selected experiment" hidden');
    expect(html).toContain('id="back-to-registry" href="/">← Back to experiments</a>');
    expect(html).toContain('id="report" hidden');
    expect(html).toContain('Viewing a report never runs a command');
    expect(html).toContain('BlackboxReportViews.capsule');
    expect(html).not.toContain('<iframe');
    expect(html).not.toContain('srcdoc');
    expect(html).not.toContain('postMessage');
  });

  it('encodes an exact selection without changing registry routes', () => {
    expect(selectionQuery({ selection: { kind: 'registry' } })).toBe('');
    expect(selectionQuery({ selection: { kind: 'report', type: 'capsule', id: 'a/b & c' } }))
      .toBe('?type=capsule&id=a%2Fb+%26+c');
  });

  it('composes selection cancellation with a bounded report request', () => {
    const html = renderRegistryPage({ providers: [fixtureProvider().provider] });
    expect(html).toContain('AbortSignal.any([signal,timeout])');
    expect(html).toContain("Showing the last snapshot; it may be stale.");
    expect(html).toContain('finally{if(state.request===controller)state.request=null}');
  });

  it('restores per-session disclosure, section, scroll, and focused report control', () => {
    const html = renderRegistryPage({ providers: [fixtureProvider().provider] });
    expect(html).toContain("const saved=state.reportStates.get(key(state.selection))||{}");
    expect(html).toContain('const y=saved.scrollY??scrollY,focus=mounted?focusState():null');
    expect(html).toContain('restoreFocus(focus);scrollTo(0,y)');
    expect(html).toContain("closest('[data-report-nav]')");
  });
});
