import { expect, it } from 'vitest';
import { readCollectorActivity } from './activity-reader.js';
import {
  postJson,
  span,
  traceA,
  traceB,
  withCollector,
} from '../test-fixtures/collector.js';

function activityRequest(): Record<string, unknown> {
  return {
    resourceSpans: [
      {
        scopeSpans: [
          {
            spans: [
              {
                ...span(traceA, 'aaaaaaaaaaaaaaaa'),
                attributes: [
                  { key: 'blackbox.activity.id', value: { stringValue: 'create-order' } },
                ],
              },
              span(traceB, 'bbbbbbbbbbbbbbbb'),
            ],
          },
        ],
      },
    ],
  };
}

it('reads only spans carrying the exact Blackbox activity identity', async () => {
  await withCollector(async ({ input, collector }) => {
    expect((await postJson(collector, activityRequest())).status).toBe(200);
    expect(await readCollectorActivity({ ...input, activityId: 'create-order' })).toMatchObject({
      kind: 'collector-activity-found',
      activityId: 'create-order',
      traceIds: [traceA],
      fragments: [
        {
          request: {
            resourceSpans: [{ scopeSpans: [{ spans: [{ traceId: traceA }] }] }],
          },
        },
      ],
    });
    expect(await readCollectorActivity({ ...input, activityId: 'missing' })).toMatchObject({
      kind: 'collector-activity-missing',
      activityId: 'missing',
    });
  });
});
