import { describe, expect, it } from 'vitest';

import { first } from './causality.fixture.js';
import { overlapping } from './scenario.fixture.js';

describe('span tree of a caused trace', () => {
  it('shows the span tree of the caused trace without the activity span, titled like show', () => {
    const trace = first(first(overlapping().activityCausality).causedTraces);
    expect(trace.spanCount).toBe(2);
    expect(trace.services).toEqual(['orders-api']);
    expect(trace.tree).toEqual([
      {
        spanId: 'a000000000000001',
        service: 'orders-api',
        kind: 'server',
        title: 'POST /orders',
        result: '',
        failure: null,
        orphan: null,
        children: [
          {
            spanId: 'a000000000000002',
            service: 'orders-api',
            kind: 'client',
            title: 'insert orders',
            result: '',
            failure: null,
            orphan: null,
            children: [],
          },
        ],
      },
    ]);
  });
});
