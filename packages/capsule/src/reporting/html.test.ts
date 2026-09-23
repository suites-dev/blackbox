import { describe, expect, it } from 'vitest';

import { renderCapsuleHtml } from '../index.js';
import type { CapsuleReportDocument } from './types.js';

const hostile = '<script>alert("x&y")</script>\'';
const escaped = '&lt;script&gt;alert(&quot;x&amp;y&quot;)&lt;/script&gt;&#39;';

function document(): CapsuleReportDocument {
  return {
    schemaVersion: 1,
    kind: 'capsule-operational-report',
    session: {
      sessionId: 'bright-river-ada', system: 'orders', title: 'Orders demo', description: undefined,
      retainedState: 'stopped', admittedAt: '2026-09-23T12:00:00.000Z',
      updatedAt: '2026-09-23T12:01:00.000Z', artifactRoot: '/private/customer/project',
    },
    lifecycle: { kind: 'stopped', retainedState: 'stopped' },
    composeProject: { kind: 'unavailable' },
    entrypoint: { kind: 'unavailable' },
    readiness: { kind: 'unavailable' },
    resources: { containers: [], networks: [], volumes: [] },
    activities: [], progress: [], cleanup: { kind: 'not-attempted' },
    failure: { kind: 'none' }, redactions: { count: 0, entries: [] },
  };
}

describe('Capsule-owned HTML renderer', () => {
  it('preserves unavailable data and renders deterministically without mutating the document', () => {
    const report = document();
    const before = structuredClone(report);
    const html = renderCapsuleHtml({ report });
    expect(html).toContain('Compose project <strong>not available</strong>');
    expect(html).toContain('not-attempted');
    expect(html).toContain('No application readiness result was retained.');
    expect(html).not.toContain(report.session.artifactRoot);
    expect(html).toContain('Artifact path <strong>[redacted]</strong>');
    expect(html).toContain('Placeholder retained intentionally: the Capsule report schema');
    expect(html).toContain('PLACEHOLDER · ASSURANCE DEFERRED');
    expect(renderCapsuleHtml({ report })).toBe(html);
    expect(report).toEqual(before);
  });

  it('escapes retained strings as text in every rendered domain, including cleanup failures', () => {
    const base = document();
    const report = {
      ...base,
      session: { ...base.session, sessionId: hostile, system: hostile },
      composeProject: { kind: 'available', value: hostile },
      entrypoint: { kind: 'available', value: { url: hostile, host: 'localhost', port: 3000, protocol: 'http' } },
      readiness: { kind: 'available', value: { url: 'http://localhost:3000', status: 'ready', durationMs: 25 } },
      resources: {
        containers: [{ participant: hostile, service: 'api', containerId: hostile, containerName: hostile, host: 'localhost', networkNames: [] }],
        networks: [hostile], volumes: [hostile],
      },
      progress: [{ kind: 'capsule-ready', stage: 'ready', sequence: 1, sessionId: 'bright-river-ada', at: hostile, durationMs: 25 }],
      activities: [{ sequence: 1, target: 'participant', participant: hostile, argv: [], startedAt: '', completedAt: '',
        outcome: { kind: 'exited', argv: [], exitCode: 0, stdout: '', stderr: '' } }],
      cleanup: { kind: 'failed', error: { name: hostile, message: hostile } },
    } satisfies CapsuleReportDocument;
    const html = renderCapsuleHtml({ report });
    expect(html).not.toContain(hostile);
    expect(html.match(/<script>/gu)).toHaveLength(1);
    expect(html).toContain(`<title>Capsule ${escaped}</title>`);
    expect(html).toContain(`<strong>${escaped}</strong>`);
    expect(html).toContain(`Compose project <strong>${escaped}</strong>`);
    expect(html).toContain('http://localhost:3000 · 25ms');
    expect(html).toContain(`<strong>${escaped}</strong><span>api · ${escaped}</span>`);
    expect(html).toContain(`<h3>capsule-ready</h3>`);
    expect(html).toContain(`Participant · ${escaped}`);
    expect(html).toContain(`${escaped}: ${escaped}`);
  });

  it('keeps host activities valid without a participant and reports completed cleanup', () => {
    const report = {
      ...document(), cleanup: { kind: 'complete' },
      activities: [{ sequence: 2, target: 'host', participant: undefined, argv: [], startedAt: '', completedAt: '',
        outcome: { kind: 'signaled', argv: [], signal: 'SIGTERM', stdout: '', stderr: '' } }],
    } satisfies CapsuleReportDocument;
    const html = renderCapsuleHtml({ report });
    expect(html).toContain('<span class="sequence">02</span>');
    expect(html).toContain('signal SIGTERM');
    expect(html).toContain('<span class="badge good">complete</span>');
    expect(html).not.toContain('undefined');
  });

});

describe('Capsule acquisition report presentation', () => {
  it('separates Docker acquisition observations from application readiness', () => {
    const report = { ...document(), progress: [{ kind: 'acquisition-observation', stage: 'acquisition',
      sequence: 1, sessionId: 'bright-river-ada', at: '2026-09-23T12:00:05.000Z',
      observation: { kind: 'service-state', participant: 'api', container: { service: 'api',
        containerId: 'abc', containerName: 'api-1', state: 'running', health: 'healthy',
        termination: { kind: 'none' } } } }] } satisfies CapsuleReportDocument;
    const html = renderCapsuleHtml({ report });
    expect(html).toContain('api · api · running · health healthy');
    expect(html).toContain('Container health never substitutes for application readiness.');
    expect(html).toContain('No application readiness result was retained.');
  });
});
