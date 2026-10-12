import { expect, it, vi } from 'vitest';

import { createActivityRegistry } from '../activity-registry.js';
import { identity, payload, snapshot, span } from '../observations.fixture.js';
import { createScopedObservationSource } from '../scoped-observations.js';
import { selectionBatches } from './selection-batches.js';

function selections() {
  const registry = createActivityRegistry(identity);
  const activities = Array.from({ length: 9 }, (_, index) =>
    registry.begin({ purpose: 'stimulus', name: `action-${index}` }),
  );
  return {
    registry,
    activities,
    batches: [
      registry.select({ kind: 'stimulus', activities: activities.slice(0, 8) }),
      registry.select({ kind: 'stimulus', activities: activities.slice(8) }),
    ],
  };
}

it('requires every bounded manifest to be trusted, distinct and from the same attempt', () => {
  const { registry, activities, batches } = selections();
  expect(() => registry.select({ kind: 'stimulus', activities })).toThrow('eight traces');
  expect(() => selectionBatches([])).toThrow('At least one');
  expect(() => selectionBatches([batches[0], structuredClone(batches[1])])).toThrow('not owned');
  expect(() => selectionBatches([batches[0], batches[0]])).toThrow('duplicate ownership');
  const foreign = createActivityRegistry({ ...identity, executionId: 'foreign' });
  expect(() =>
    selectionBatches([
      batches[0],
      foreign.select({
        kind: 'stimulus',
        activities: [foreign.begin({ purpose: 'stimulus', name: 'foreign' })],
      }),
    ]),
  ).toThrow('attempt identity');
  const inspection = registry.begin({ purpose: 'inspection', name: 'read' });
  expect(() =>
    selectionBatches([
      batches[0],
      registry.select({ kind: 'inspection', activities: [inspection] }),
    ]),
  ).toThrow('kind');
  const combined = selectionBatches(batches);
  expect(combined.scope.activities).toHaveLength(9);
  expect(selectionBatches([...batches].reverse()).scope.scopeId).toBe(combined.scope.scopeId);
  // The aggregate reporting manifest cannot bypass bounded registry admission.
  expect(() => selectionBatches(combined.scope)).toThrow('not owned');
});

it.each(['bytes', 'spans'] as const)(
  'keeps one cumulative %s rejection budget across all selection batches',
  async (budget) => {
    const { activities, batches } = selections();
    const captured = snapshot(
      activities.map((activity, index) => ({
        traceId: activity.context.traceId,
        payload:
          budget === 'bytes'
            ? { ...payload([span(activity)]), padding: 'x'.repeat(30 * 1024) }
            : payload(
                Array.from({ length: index === 8 ? 33 : 28 }, (_, child) =>
                  span(activity, (child + 1).toString(16).padStart(16, '0')),
                ),
              ),
      })),
    );
    const readSnapshot = vi.fn().mockResolvedValue(captured);
    const result = await createScopedObservationSource(
      { selection: batches, storageDirectory: '/owned/collector' },
      { readSnapshot },
    ).read();
    expect(readSnapshot).toHaveBeenCalledExactlyOnceWith({
      ...identity,
      storageDirectory: '/owned/collector',
    });
    expect(result).toMatchObject({
      kind: 'rejected',
      message: expect.stringContaining(budget === 'bytes' ? '256 KiB' : '256 span identities'),
    });
    expect(result).not.toHaveProperty('payloads');
  },
);
