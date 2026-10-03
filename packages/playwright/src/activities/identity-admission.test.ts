import { describe, expect, it } from 'vitest';

import { createActivityRegistry } from './activity-registry.js';
import { identity, payload, snapshot, span } from './observations.fixture.js';
import { createScopedObservationSource } from './scoped-observations.js';

function boundary() {
  const registry = createActivityRegistry(identity);
  const activity = registry.begin({ purpose: 'stimulus', name: 'create' });
  const selection = registry.select({ kind: 'stimulus', activities: [activity] });
  return { activity, selection };
}

describe('explicit raw identity contradictions', () => {
  it.each(['resource', 'span'] as const)('admits matching markers on a %s', async (location) => {
    const { activity, selection } = boundary();
    const attributes = [
      ['blackbox.session.id', identity.sessionId],
      ['blackbox.execution.id', identity.executionId],
      ['blackbox.activity.id', activity.activityId],
      ['blackbox.activity.purpose', activity.purpose],
    ].map(([key, value]) => ({ key, value: { stringValue: value } }));
    const raw = payload([{ ...span(activity), ...(location === 'span' ? { attributes } : {}) }]);
    if (location === 'resource') {
      raw.resourceSpans[0].resource.attributes.push(...attributes);
    }
    const captured = snapshot([{ traceId: activity.context.traceId, payload: raw }]);
    const source = createScopedObservationSource(
      { selection, storageDirectory: '/owned/collector' },
      { readSnapshot: () => Promise.resolve(captured) },
    );
    expect(await source.read()).toMatchObject({ kind: 'admitted', payloads: [raw] });
  });

  it.each([
    ['resource', 'blackbox.session.id'],
    ['span', 'blackbox.session.id'],
    ['resource', 'blackbox.execution.id'],
    ['span', 'blackbox.execution.id'],
    ['resource', 'blackbox.activity.id'],
    ['span', 'blackbox.activity.id'],
    ['resource', 'blackbox.activity.purpose'],
    ['span', 'blackbox.activity.purpose'],
  ])('rejects a conflicting %s %s marker atomically', async (location, key) => {
    const { activity, selection } = boundary();
    const attributes = [{ key, value: { stringValue: 'foreign' } }];
    const raw = payload([{ ...span(activity), ...(location === 'span' ? { attributes } : {}) }]);
    if (location === 'resource') {
      raw.resourceSpans[0].resource.attributes.push(...attributes);
    }
    const captured = snapshot([{ traceId: activity.context.traceId, payload: raw }]);
    const source = createScopedObservationSource(
      { selection, storageDirectory: '/owned/collector' },
      { readSnapshot: () => Promise.resolve(captured) },
    );
    const result = await source.read();
    expect(result).toMatchObject({ kind: 'rejected', message: expect.stringContaining('marker') });
    expect(result).not.toHaveProperty('payloads');
  });

  it('rejects duplicated trace envelopes without picking a favorable copy', async () => {
    const { activity, selection } = boundary();
    const captured = snapshot(
      Array.from({ length: 2 }, () => ({
        traceId: activity.context.traceId,
        payload: payload([span(activity)]),
      })),
    );
    const source = createScopedObservationSource(
      { selection, storageDirectory: '/owned/collector' },
      { readSnapshot: () => Promise.resolve(captured) },
    );
    expect(await source.read()).toEqual({
      kind: 'rejected',
      message: 'Duplicate trace entry in activity snapshot.',
    });
  });
});
