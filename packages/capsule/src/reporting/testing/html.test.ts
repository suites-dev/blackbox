import { Script } from 'node:vm';
import { describe, expect, it } from 'vitest';

import { capsuleReportClientView, renderCapsuleHtml } from '../../index.js';
import type { CapsuleReportDocument } from '../types.js';

const hostile = '<script>alert("x&y")</script>\'';
const escaped = '&lt;script&gt;alert(&quot;x&amp;y&quot;)&lt;/script&gt;&#39;';

function document(): CapsuleReportDocument {
  return {
    schemaVersion: 1,
    kind: 'capsule-operational-report',
    session: {
      sessionId: 'bright-river-ada',
      system: 'orders',
      title: 'Orders demo',
      description: { kind: 'omitted' },
      retainedState: 'stopped',
      admittedAt: '2026-09-23T12:00:00.000Z',
      updatedAt: '2026-09-23T12:01:00.000Z',
      artifactRoot: '/private/customer/project',
    },
    lifecycle: { kind: 'stopped', retainedState: 'stopped' },
    composeProject: { kind: 'unavailable' },
    entrypoint: { kind: 'unavailable' },
    readiness: { kind: 'unavailable' },
    resources: { containers: [], networks: [], volumes: [] },
    activities: [],
    activityTelemetry: [],
    progress: [],
    observations: {
      kind: 'collector-session-missing',
      message: 'No retained collector session exists.',
    },
    cleanup: { kind: 'not-attempted' },
    failure: { kind: 'none' },
    redactions: { count: 0, entries: [] },
  };
}

function hostileDocument(): CapsuleReportDocument {
  const base = document();
  return {
    ...base,
    session: { ...base.session, sessionId: hostile, system: hostile },
    composeProject: { kind: 'available', value: hostile },
    entrypoint: {
      kind: 'available',
      value: { url: hostile, host: 'localhost', port: 3000, protocol: 'http' },
    },
    readiness: {
      kind: 'available',
      value: { url: 'http://localhost:3000', status: 'ready', durationMs: 25 },
    },
    resources: {
      containers: [
        {
          participant: hostile,
          service: 'api',
          containerId: hostile,
          containerName: hostile,
          host: 'localhost',
          networkNames: [],
        },
      ],
      networks: [hostile],
      volumes: [hostile],
    },
    progress: [
      {
        kind: 'capsule-ready',
        stage: 'ready',
        sequence: 1,
        sessionId: 'bright-river-ada',
        at: hostile,
        durationMs: 25,
      },
    ],
    activities: [
      {
        kind: 'completed',
        activityId: 'activity-1',
        sequence: 1,
        target: { kind: 'participant', participant: hostile },
        argv: [],
        startedAt: '',
        completedAt: '',
        outcome: { kind: 'exited', argv: [], exitCode: 0, stdout: '', stderr: '' },
      },
    ],
    activityTelemetry: [
      {
        kind: 'available',
        activityId: 'activity-1',
        spans: [
          {
            traceId: '11111111111111111111111111111111',
            spanId: '2222222222222222',
            parentSpanId: null,
            operation: hostile,
            service: hostile,
            startTimeUnixNano: null,
            endTimeUnixNano: null,
            statusCode: null,
            attributes: [{ key: 'http.method', value: hostile }],
            links: [],
          },
        ],
      },
    ],
    cleanup: { kind: 'failed', error: { name: hostile, message: hostile } },
  };
}

describe('Capsule-owned HTML renderer', () => {
  it('preserves unavailable data and renders deterministically without mutating the document', () => {
    const report = document();
    const before = structuredClone(report);
    const html = renderCapsuleHtml({ report });
    expect(html).toContain('const capsuleReportData=');
    expect(html).toContain('No application readiness result was retained.');
    expect(html).not.toContain(report.session.artifactRoot);
    expect(html).toContain('Artifact path [redacted]');
    expect(html).toContain('Placeholder retained intentionally: the Capsule report schema');
    expect(html).toContain('PLACEHOLDER · ASSURANCE DEFERRED');
    expect(html).not.toContain('<iframe');
    expect(html).not.toContain('postMessage');
    expect(renderCapsuleHtml({ report })).toBe(html);
    expect(report).toEqual(before);
  });

  it('escapes retained strings as text in every rendered domain, including cleanup failures', () => {
    const html = renderCapsuleHtml({ report: hostileDocument() });
    expect(html).not.toContain(hostile);
    expect(html.match(/<script>/gu)).toHaveLength(1);
    expect(html).toContain(`<title>Capsule ${escaped}</title>`);
    expect(html).toContain('\\u003cscript>alert(\\"x&y\\")\\u003c/script>');
    expect(html).toContain('http://localhost:3000');
    expect(html).toContain('capsule-ready');
  });

  it('keeps host activities valid without a participant and reports completed cleanup', () => {
    const report = {
      ...document(),
      cleanup: { kind: 'complete' },
      activities: [
        {
          kind: 'completed',
          activityId: 'activity-2',
          sequence: 2,
          target: { kind: 'host' },
          argv: [],
          startedAt: '',
          completedAt: '',
          outcome: { kind: 'signaled', argv: [], signal: 'SIGTERM', stdout: '', stderr: '' },
        },
      ],
    } satisfies CapsuleReportDocument;
    const html = renderCapsuleHtml({ report });
    expect(html).toContain('"sequence":2');
    expect(html).toContain('"signal":"SIGTERM"');
    expect(html).toContain('"cleanup":{"kind":"complete"}');
  });
});

describe('Capsule acquisition report presentation', () => {
  it('separates Docker acquisition observations from application readiness', () => {
    const report = {
      ...document(),
      progress: [
        {
          kind: 'acquisition-observation',
          stage: 'acquisition',
          sequence: 1,
          sessionId: 'bright-river-ada',
          at: '2026-09-23T12:00:05.000Z',
          observation: {
            kind: 'service-state',
            participant: 'api',
            container: {
              service: 'api',
              containerId: 'abc',
              containerName: 'api-1',
              state: 'running',
              health: 'healthy',
              termination: { kind: 'none' },
            },
          },
        },
      ],
    } satisfies CapsuleReportDocument;
    const html = renderCapsuleHtml({ report });
    expect(html).toContain('"kind":"acquisition-observation"');
    expect(html).toContain('"state":"running","health":"healthy"');
    expect(html).toContain('Docker health and application readiness remain separate.');
    expect(html).toContain('No application readiness result was retained.');
  });
});

describe('shared mockup presentation', () => {
  it('embeds the exact served renderer and styles in offline exports with no network assets', () => {
    const html = renderCapsuleHtml({ report: document() });
    expect(html).toContain(capsuleReportClientView.script);
    expect(html).toContain(capsuleReportClientView.styles);
    expect(html).toContain('report-workspace');
    expect(html).toContain('report-inspector');
    expect(html).toContain('Raw telemetry');
    expect(html).toContain('What was observed');
    expect(html).toContain("createElementNS('http://www.w3.org/2000/svg'");
    expect(html).toContain('Inter,ui-sans-serif,system-ui');
    expect(html).not.toContain('fonts.googleapis');
    expect(html).not.toContain('<link');
    expect(html).not.toContain('.innerHTML');
    expect(() =>
      new Script(capsuleReportClientView.script).runInNewContext({ BlackboxReportViews: {} }),
    ).not.toThrow();
  });
});
