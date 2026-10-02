import { expect, it } from 'vitest';

import { createAttemptTraceContext, tracedHeaders } from './trace-context.js';

it('creates a sampled W3C traceparent whose trace ID it exposes', () => {
  const trace = createAttemptTraceContext();
  expect(trace.traceparent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/u);
  expect(trace.traceparent.split('-')[1]).toBe(trace.traceId);
  expect(createAttemptTraceContext().traceId).not.toBe(trace.traceId);
});

it('never uses the all-zero IDs that W3C reserves as invalid', () => {
  const draws = [Buffer.alloc(16), Buffer.alloc(16, 1), Buffer.alloc(8), Buffer.alloc(8, 2)];
  const trace = createAttemptTraceContext(() => draws.shift()!);
  expect(trace.traceparent).toBe(`00-${'01'.repeat(16)}-${'02'.repeat(8)}-01`);
});

it('adds traceparent to configured headers but never replaces one the project set', () => {
  const trace = createAttemptTraceContext();
  expect(tracedHeaders(undefined, trace)).toEqual({ traceparent: trace.traceparent });
  expect(tracedHeaders({ 'x-tenant': 'a' }, trace)).toEqual({
    'x-tenant': 'a',
    traceparent: trace.traceparent,
  });
  const own = { TraceParent: '00-11111111111111111111111111111111-2222222222222222-01' };
  expect(tracedHeaders(own, trace)).toBe(own);
});
