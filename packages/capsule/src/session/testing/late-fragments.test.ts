import { afterEach, expect, it } from 'vitest';

import { readCapsuleActivityObservations } from '../activity-observations.js';
import { reportCapsule } from '../operations.js';
import { renderCapsuleHtml } from '../../reporting/html.js';
import { serializeCapsuleReportDocument } from '../../reporting/serialization.js';
import { cleanObservationFixtures, collectorFixture, sessionFixture, traceId } from './observations.fixture.js';

afterEach(cleanObservationFixtures);

it('incorporates late descendants while keeping an independent shared-state trace session-only', async () => {
  const fixture = await sessionFixture('quiet-forest-ada', 'activity-late');
  const collector = await collectorFixture(fixture);
  const independent = '33333333333333333333333333333333';
  const post = async (spans: readonly object[]) => {
    const response = await fetch(collector.endpoint.tracesUrl, {
      method: 'POST', headers: { authorization: 'Bearer observations-test-token',
        'content-type': 'application/json' },
      body: JSON.stringify({ resourceSpans: [{ scopeSpans: [{ spans }] }] }),
    });
    expect(response.status).toBe(200);
  };
  await post([
    { traceId, spanId: 'aaaaaaaaaaaaaaaa', name: 'capsule-root' },
    { traceId: independent, spanId: 'cccccccccccccccc', name: 'independent-consumer' },
  ]);
  const selector = { ...fixture, activityId: 'activity-late' };
  const first = await readCapsuleActivityObservations(selector);
  expect(first).toMatchObject({ kind: 'collector-activity-found', traceIds: [traceId],
    fragments: [{ sequence: 1 }] });
  expect(JSON.stringify(first)).toContain('capsule-root');
  expect(JSON.stringify(first)).not.toContain('independent-consumer');

  await post([{ traceId, spanId: 'bbbbbbbbbbbbbbbb', parentSpanId: 'aaaaaaaaaaaaaaaa',
    name: 'late-descendant-without-activity-attribute' }]);
  const latest = await readCapsuleActivityObservations(selector);
  expect(latest).toMatchObject({ kind: 'collector-activity-found', traceIds: [traceId],
    fragments: [{ sequence: 1 }, { sequence: 2 }] });
  expect(JSON.stringify(latest)).toContain('late-descendant-without-activity-attribute');
  expect(JSON.stringify(latest)).not.toContain(independent);

  const report = await reportCapsule(fixture);
  expect(report.kind).toBe('capsule-report');
  if (report.kind !== 'capsule-report') {
    throw new Error(`Unexpected report result: ${report.kind}`);
  }
  expect(report.document.observations).toMatchObject({ kind: 'collector-session-found',
    fragmentCount: 2, traces: { activityCorrelated: [{ traceId, activityIds: ['activity-late'] }],
      sessionOnly: [independent] } });
  const json = serializeCapsuleReportDocument({ document: report.document });
  const html = renderCapsuleHtml({ report: report.document });
  for (const representation of [json, html]) {
    expect(representation).toContain('late-descendant-without-activity-attribute');
    expect(representation).toContain(independent);
    expect(representation).not.toContain('independent-consumer');
  }
});
