import { describe, expect, it, test } from 'vitest';
import { runInNewContext } from 'node:vm';

import { renderRegistryPage, selectionQuery } from './registry-page.js';
import { fixtureProvider } from '../test-fixtures/provider.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function runProviderScripts(html: string): Record<string, unknown> {
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/gu)].map((match) => match[1]);
  const start = scripts.findIndex((script) => script.includes('const BlackboxReportViews='));
  const context: Record<string, unknown> = {};
  runInNewContext(scripts[start], context);
  for (const script of scripts.slice(start + 1, -1)) {
    try {
      runInNewContext(script, context);
    } catch {
      // Browser script elements continue independently after a provider failure.
    }
  }
  const views: unknown = runInNewContext('BlackboxReportViews;', context);
  if (!isRecord(views)) {
    throw new Error('Expected a provider view registry.');
  }
  return views;
}

describe('report registry UI', () => {
  it('renders accessible discovery controls and an exact-session report host', () => {
    const html = renderRegistryPage({ providers: [fixtureProvider().provider] });
    expect(html).toContain('CAPSULE · EXPERIMENT REGISTRY');
    expect(html).toContain('aria-label="Filter by session state"');
    expect(html).toContain('id="search" type="search"');
    expect(html).toContain('id="registry-view"');
    expect(html).toContain(
      'id="report-view" class="detail" aria-label="Selected experiment" hidden',
    );
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
    expect(selectionQuery({ selection: { kind: 'report', type: 'capsule', id: 'a/b & c' } })).toBe(
      '?type=capsule&id=a%2Fb+%26+c',
    );
  });

  it('composes selection cancellation with a bounded report request', () => {
    const html = renderRegistryPage({ providers: [fixtureProvider().provider] });
    expect(html).toContain('AbortSignal.any([signal,timeout])');
    expect(html).toContain('Showing the last snapshot; it may be stale.');
    expect(html).toContain('finally{if(state.request===controller)state.request=null}');
  });

  it('restores per-session disclosure, section, scroll, and focused report control', () => {
    const html = renderRegistryPage({ providers: [fixtureProvider().provider] });
    expect(html).toContain('const saved=state.reportStates.get(key(state.selection))||{}');
    expect(html).toContain('const y=saved.scrollY??scrollY,focus=mounted?focusState():null');
    expect(html).toContain('restoreFocus(focus);scrollTo(0,y)');
    expect(html).toContain("closest('[data-report-nav]')");
  });
});

test('audit L8: isolates provider view syntax errors from other views', () => {
  const first = fixtureProvider().provider;
  const second = {
    ...first,
    type: 'other',
    view: {
      ...first.view,
      script: "BlackboxReportViews.other={name:'other'};",
    },
  };
  const html = renderRegistryPage({
    providers: [
      {
        ...first,
        view: { ...first.view, script: 'if (' },
      },
      second,
    ],
  });
  const views = runProviderScripts(html);
  expect(views.other).toEqual({ name: 'other' });
});

test('audit L8: keeps a provider line comment from hiding the wrapper', () => {
  const first = fixtureProvider().provider;
  const second = {
    ...first,
    type: 'other',
    view: {
      ...first.view,
      script: "BlackboxReportViews.other={name:'other'};",
    },
  };
  const html = renderRegistryPage({
    providers: [
      {
        ...first,
        view: { ...first.view, script: '// note' },
      },
      second,
    ],
  });
  const views = runProviderScripts(html);
  expect(views.other).toEqual({ name: 'other' });
});

test('audit L8: continues after a provider initializer throws', () => {
  const first = fixtureProvider().provider;
  const second = {
    ...first,
    type: 'other',
    view: { ...first.view, script: "BlackboxReportViews.other={name:'other'};" },
  };
  const html = renderRegistryPage({
    providers: [
      { ...first, view: { ...first.view, script: "throw new Error('optional global');" } },
      second,
    ],
  });
  const views = runProviderScripts(html);
  expect(views.other).toEqual({ name: 'other' });
});

test('audit L8: allows provider locals that would collide with a wrapper', () => {
  const provider = fixtureProvider().provider;
  const html = renderRegistryPage({
    providers: [
      {
        ...provider,
        view: {
          ...provider.view,
          script: "const view={name:'local'};BlackboxReportViews.capsule=view;",
        },
      },
    ],
  });
  const views = runProviderScripts(html);
  expect(views.capsule).toEqual({ name: 'local' });
});

test('audit L8: reports a provider view syntax error with its provider type', () => {
  const html = renderRegistryPage({
    providers: [
      {
        ...fixtureProvider().provider,
        type: 'broken-provider',
        view: { ...fixtureProvider().provider.view, script: 'if (' },
      },
    ],
  });
  expect(html).toContain(
    'console.error("Blackbox report view failed for provider type: broken-provider")',
  );
});

test("audit L8: prevents providers from overwriting each other's view entries", () => {
  const first = fixtureProvider().provider;
  const second = {
    ...first,
    type: 'other',
    view: {
      ...first.view,
      script: "BlackboxReportViews.capsule={owner:'other'};",
    },
  };
  const html = renderRegistryPage({
    providers: [
      {
        ...first,
        view: { ...first.view, script: "BlackboxReportViews.capsule={owner:'first'};" },
      },
      second,
    ],
  });
  const views = runProviderScripts(html);
  expect(views.capsule).toEqual({ owner: 'first' });
});
