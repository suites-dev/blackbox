import { describe, expect, it } from 'vitest';

import { arrivedActivityIds, markActivityArrivals, REGISTRY_SCRIPT } from './registry-script.js';

function report(activityIds: readonly string[], updatedAt = '2026-09-25T10:00:00Z') {
  return {
    kind: 'capsule-operational-report',
    updatedAt,
    activities: activityIds.map((activityId) => ({ activityId })),
  };
}

function arrivalNode(activityId: string) {
  const classes = new Set<string>();
  let finishAnimation: () => void = () => undefined;
  return {
    classes,
    element: {
      dataset: { activityId },
      classList: {
        add: (name: string) => {
          classes.add(name);
        },
        remove: (name: string) => {
          classes.delete(name);
        },
      },
      addEventListener: (_type: 'animationend', listener: () => void) => {
        finishAnimation = listener;
      },
    },
    finishAnimation: () => {
      finishAnimation();
    },
  };
}

describe('live report activity arrivals', () => {
  it('uses the first loaded report as a baseline without marking its existing activities', () => {
    const existing = arrivalNode('activity-1');
    const arrivals = arrivedActivityIds(null, report(['activity-1']));

    markActivityArrivals({ querySelectorAll: () => [existing.element] }, arrivals, () => undefined);

    expect(arrivals).toEqual([]);
    expect(existing.classes).not.toContain('activity-arrived');
  });

  it('marks only an activity newly introduced by a polled report and clears the hook', () => {
    const existing = arrivalNode('activity-1');
    const arrived = arrivalNode('activity-2');
    const arrivals = arrivedActivityIds(
      report(['activity-1']),
      report(['activity-2', 'activity-1']),
    );
    const scheduled: (() => void)[] = [];

    markActivityArrivals(
      { querySelectorAll: () => [arrived.element, existing.element] },
      arrivals,
      (clear, timeout) => {
        expect(timeout).toBe(2000);
        scheduled.push(clear);
      },
    );

    expect(arrivals).toEqual(['activity-2']);
    expect(arrived.classes).toContain('activity-arrived');
    expect(existing.classes).not.toContain('activity-arrived');
    arrived.finishAnimation();
    expect(arrived.classes).not.toContain('activity-arrived');
    expect(scheduled).toHaveLength(1);
  });

  it('does not mark an activity when unrelated report data refreshes', () => {
    const existing = arrivalNode('activity-1');
    const arrivals = arrivedActivityIds(
      report(['activity-1']),
      report(['activity-1'], '2026-09-25T10:00:01Z'),
    );

    markActivityArrivals({ querySelectorAll: () => [existing.element] }, arrivals, () => undefined);

    expect(arrivals).toEqual([]);
    expect(existing.classes).not.toContain('activity-arrived');
    expect(REGISTRY_SCRIPT).toContain(
      'renderDocument(current,result.document,bytes,arrivedActivityIds(state.reportDocument,result.document))',
    );
  });
});
