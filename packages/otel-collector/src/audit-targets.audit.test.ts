import { expect, test, vi } from 'vitest';

import packagedCollectorLifecycleSchema from '../schema/collector-lifecycle-v1.json' with { type: 'json' };
import { collectorLifecycleSchema } from './schema/index.js';
import { parseLifecycle } from './lifecycle/store.js';
import { readCollectorSession } from './storage/reader.js';
import { postJson, span, traceA, traceB, withCollector } from './test-fixtures/collector.js';

test.fails('audit M3: every read rescans and parses all retained fragments', async () => {
  await withCollector(async ({ input, collector }) => {
    const request = {
      resourceSpans: [{ scopeSpans: [{ spans: [span(traceA, 'aaaaaaaaaaaaaaaa')] }] }],
    };
    const secondRequest = {
      resourceSpans: [{ scopeSpans: [{ spans: [span(traceB, 'bbbbbbbbbbbbbbbb')] }] }],
    };
    expect((await postJson(collector, request)).status).toBe(200);
    expect((await postJson(collector, secondRequest)).status).toBe(200);

    const parseSpy = vi.spyOn(JSON, 'parse');
    try {
      await readCollectorSession(input);
      const firstReadParses = parseSpy.mock.calls.length;
      parseSpy.mockClear();
      await readCollectorSession(input);
      const secondReadParses = parseSpy.mock.calls.length;

      expect(firstReadParses).toBeGreaterThan(0);
      expect(secondReadParses).toBe(0);
    } finally {
      parseSpy.mockRestore();
    }
  });
});

test('audit M9: schema accepts empty runs but parser rejects lifecycle', () => {
  expect(packagedCollectorLifecycleSchema).toEqual(collectorLifecycleSchema);
  expect(collectorLifecycleSchema.properties.runs).toMatchObject({ minItems: 1 });

  const lifecycle = {
    schemaVersion: 1,
    sessionId: 'audit-session',
    executionId: 'audit-execution',
    revision: 1,
    runs: [],
    telemetry: {
      status: 'not-received',
      acceptedRequests: 0,
      acceptedSpans: 0,
      lastReceivedAt: null,
    },
  };

  expect(() =>
    parseLifecycle({
      text: JSON.stringify(lifecycle),
      identity: { sessionId: 'audit-session', executionId: 'audit-execution' },
    }),
  ).toThrow('corrupt');
});
