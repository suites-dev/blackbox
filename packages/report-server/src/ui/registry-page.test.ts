import { describe, expect, it, test } from 'vitest';
import { runInNewContext } from 'node:vm';

import { renderRegistryPage, selectionQuery } from './registry-page.js';
import { fixtureProvider } from '../test-fixtures/provider.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getScriptTexts(html: string): string[] {
  return [...html.matchAll(/<script>([\s\S]*?)<\/script>/gu)].map((match) => match[1]);
}

function runProviderScripts(html: string): {
  views: Record<string, unknown>;
  errors: string[];
} {
  const scripts = getScriptTexts(html);
  const start = scripts.findIndex((script) => script.includes('const BlackboxReportViews='));
  const errors: string[] = [];
  const context = {
    console: {
      error(message: unknown) {
        errors.push(String(message));
      },
    },
  } satisfies Record<string, unknown>;
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
  return { views, errors };
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
  const result = runProviderScripts(html);
  expect(result.views.other).toEqual({ name: 'other' });
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
  const result = runProviderScripts(html);
  expect(result.views.other).toEqual({ name: 'other' });
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
  const result = runProviderScripts(html);
  expect(result.views.other).toEqual({ name: 'other' });
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
  const result = runProviderScripts(html);
  expect(result.views.capsule).toEqual({ name: 'local' });
});

test('audit L8: isolates duplicate provider locals between providers', () => {
  const first = fixtureProvider().provider;
  const second = {
    ...first,
    type: 'other',
    view: {
      ...first.view,
      script: "const view={name:'other'};BlackboxReportViews.other=view;",
    },
  };
  const html = renderRegistryPage({
    providers: [
      {
        ...first,
        view: {
          ...first.view,
          script: "const view={name:'first'};BlackboxReportViews.first=view;",
        },
      },
      second,
    ],
  });
  const result = runProviderScripts(html);
  expect(result.views.first).toEqual({ name: 'first' });
  expect(result.views.other).toEqual({ name: 'other' });
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
  const result = runProviderScripts(html);
  expect(result.errors).toContain('Blackbox report view failed for provider type: broken-provider');
});

test('reports a provider initializer error with its provider type', () => {
  const html = renderRegistryPage({
    providers: [
      {
        ...fixtureProvider().provider,
        type: 'broken-provider',
        view: { ...fixtureProvider().provider.view, script: "throw new Error('optional global');" },
      },
    ],
  });
  const result = runProviderScripts(html);
  expect(result.errors).toContain('Blackbox report view failed for provider type: broken-provider');
});

test('does not report a valid provider view', () => {
  const html = renderRegistryPage({ providers: [fixtureProvider().provider] });
  const result = runProviderScripts(html);
  expect(result.errors).toEqual([]);
});

test('escapes a provider type before embedding it in script text', () => {
  const provider = fixtureProvider().provider;
  const html = renderRegistryPage({
    providers: [
      {
        ...provider,
        type: '</script>',
      },
    ],
  });
  const scripts = getScriptTexts(html);
  const postProviderScripts = scripts.filter((script) => script.includes('Object.defineProperty'));
  expect(postProviderScripts).toHaveLength(1);
  expect(postProviderScripts[0]).toContain('\\u003C/script>');
  expect(html.match(/<\/script>/gu)).toHaveLength(4);
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
  const result = runProviderScripts(html);
  expect(result.views.capsule).toEqual({ owner: 'first' });
});
