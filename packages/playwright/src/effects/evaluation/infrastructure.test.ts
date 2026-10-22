import { describe, expect, it } from 'vitest';

import { infrastructureClass, observationExcerpts } from './observation-artifact.js';

const span = (name: string, spanId: string) => ({
  traceId: '1'.repeat(32),
  spanId,
  name,
  kind: 3,
  attributes: [],
});
const payload = (scope: string, spans: unknown[]) => ({
  resourceSpans: [
    { resource: { attributes: [] }, scopeSpans: [{ scope: { name: scope }, spans }] },
  ],
});

describe('infrastructure span classification', () => {
  it('classifies only exact pairs of instrumentation scope and span name', () => {
    expect(infrastructureClass('@opentelemetry/instrumentation-pg', 'pg-pool.connect')).toBe(
      'connection-pool',
    );
    expect(infrastructureClass('@opentelemetry/instrumentation-pg', 'pg.connect')).toBe(
      'connection-establishment',
    );
    expect(
      infrastructureClass('@opentelemetry/instrumentation-pg', 'pg.query:INSERT subscriptions'),
    ).toBeNull();
    expect(infrastructureClass('some-other-scope', 'pg-pool.connect')).toBeNull();
  });

  it('marks excerpts by their own scope and leaves every other span unclassified', () => {
    const { excerpts } = observationExcerpts(
      [
        payload('@opentelemetry/instrumentation-pg', [
          span('pg-pool.connect', 'a'.repeat(16)),
          span('pg.query:SELECT users', 'b'.repeat(16)),
        ]),
        payload('app', [span('pg-pool.connect', 'c'.repeat(16))]),
      ],
      16,
    );
    expect(excerpts.map(({ infrastructure }) => infrastructure)).toEqual([
      'connection-pool',
      null,
      null,
    ]);
  });
});
