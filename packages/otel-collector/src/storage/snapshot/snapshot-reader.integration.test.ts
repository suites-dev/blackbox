import { expect, it } from 'vitest';

import {
  projectCollectorActivity,
  projectCollectorSession,
  projectCollectorTrace,
  projectCollectorTraces,
} from './snapshot-projections.js';
import { readCollectorSnapshot } from './snapshot-reader.js';
import { postJson, span, traceA, traceB, withCollector } from '../../test-fixtures/collector.js';

it('projects every report view from one retained collector snapshot', async () => {
  await withCollector(async ({ input, collector }) => {
    const request = {
      resourceSpans: [
        {
          scopeSpans: [
            { spans: [span(traceA, 'aaaaaaaaaaaaaaaa'), span(traceB, 'bbbbbbbbbbbbbbbb')] },
          ],
        },
      ],
    };
    expect((await postJson(collector, request)).status).toBe(200);

    const snapshot = await readCollectorSnapshot(input);
    expect(projectCollectorSession(snapshot)).toMatchObject({
      kind: 'collector-session-found',
      traceIds: [traceA, traceB],
    });
    expect(projectCollectorTraces(snapshot)).toMatchObject({
      kind: 'collector-traces-found',
      traces: [
        {
          traceId: traceA,
          fragments: [
            {
              request: {
                resourceSpans: [{ scopeSpans: [{ spans: [{ traceId: traceA }] }] }],
              },
            },
          ],
        },
        {
          traceId: traceB,
          fragments: [
            {
              request: {
                resourceSpans: [{ scopeSpans: [{ spans: [{ traceId: traceB }] }] }],
              },
            },
          ],
        },
      ],
    });
    expect(projectCollectorTrace({ snapshot, traceId: traceA })).toMatchObject({
      kind: 'collector-trace-found',
      traceId: traceA,
    });
    expect(
      projectCollectorActivity({ snapshot, activityId: 'activity-a', traceId: traceA }),
    ).toMatchObject({
      kind: 'collector-activity-found',
      activityId: 'activity-a',
      traceIds: [traceA],
    });
  });
});
