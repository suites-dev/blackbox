import { describe, expect, it } from 'vitest';

import { createActivityRegistry, requireTrustedSelection } from './activity-registry.js';
import { identity } from './observations.fixture.js';

describe('trusted activity registration', () => {
  it('allocates immutable fresh trace context before any observations arrive', () => {
    const registry = createActivityRegistry(identity);
    const first = registry.begin({ purpose: 'stimulus', name: 'create order' });
    const second = registry.begin({ purpose: 'inspection', name: 'read order' });
    expect(first.context.traceId).not.toBe(second.context.traceId);
    expect(first.context.traceparent).toBe(
      `00-${first.context.traceId}-${first.context.spanId}-01`,
    );
    expect(Object.isFrozen(first.context.traceState)).toBe(true);
    expect(() => Object.assign(first.context, { traceId: second.context.traceId })).toThrow(
      TypeError,
    );
  });

  it('rejects copied and foreign activity handles even under identical session identity', () => {
    const registry = createActivityRegistry(identity);
    const foreign = createActivityRegistry(identity).begin({
      purpose: 'stimulus',
      name: 'foreign',
    });
    const owned = registry.begin({ purpose: 'stimulus', name: 'owned' });
    for (const activity of [foreign, structuredClone(owned)]) {
      expect(() => registry.select({ kind: 'stimulus', activities: [activity] })).toThrow(
        'not owned',
      );
      expect(() => {
        registry.finish(activity, { kind: 'telemetry-scope-succeeded' });
      }).toThrow('not owned');
    }
  });

  it('rejects inspection and setup under a stimulus selection', () => {
    const registry = createActivityRegistry(identity);
    for (const purpose of ['inspection', 'setup'] as const) {
      const activity = registry.begin({ purpose, name: purpose });
      expect(() => registry.select({ kind: 'stimulus', activities: [activity] })).toThrow(
        'purpose',
      );
    }
  });

  it('admits an explicit procedure union and freezes its membership before later registrations', () => {
    const registry = createActivityRegistry(identity);
    const stimulus = registry.begin({ purpose: 'stimulus', name: 'create' });
    const inspection = registry.begin({ purpose: 'inspection', name: 'read' });
    const selection = registry.select({ kind: 'procedure', activities: [stimulus, inspection] });
    const reversed = registry.select({ kind: 'procedure', activities: [inspection, stimulus] });
    expect(reversed).toEqual(selection);
    expect(selection.activities.map((activity) => activity.purpose).sort()).toEqual([
      'inspection',
      'stimulus',
    ]);
    registry.begin({ purpose: 'stimulus', name: 'later' });
    expect(selection.activities).toHaveLength(2);
    expect(() => Object.assign(selection.activities[0], { purpose: 'setup' })).toThrow(TypeError);
  });
});

describe('selection ownership and bounded lifecycle', () => {
  it('rejects a structural copy of an otherwise valid selection', () => {
    const registry = createActivityRegistry(identity);
    const activity = registry.begin({ purpose: 'stimulus', name: 'create' });
    const selection = registry.select({ kind: 'stimulus', activities: [activity] });
    expect(() => {
      requireTrustedSelection(selection);
    }).not.toThrow();
    expect(() => {
      requireTrustedSelection(structuredClone(selection));
    }).toThrow('not owned');
  });

  it('completion does not close evidence or change selection and rejects double completion', () => {
    const registry = createActivityRegistry(identity);
    const activity = registry.begin({ purpose: 'stimulus', name: 'create' });
    const selection = registry.select({ kind: 'stimulus', activities: [activity] });
    registry.finish(activity, { kind: 'telemetry-scope-succeeded' });
    expect(registry.select({ kind: 'stimulus', activities: [activity] })).toEqual(selection);
    expect(selection).not.toHaveProperty('closed');
    expect(selection).not.toHaveProperty('coverage');
    expect(() => {
      registry.finish(activity, { kind: 'telemetry-scope-succeeded' });
    }).toThrow('already complete');
  });

  it('rejects empty, duplicate and over-limit selections without truncation', () => {
    const registry = createActivityRegistry(identity);
    const activities = Array.from({ length: 9 }, () =>
      registry.begin({ purpose: 'stimulus', name: 'action' }),
    );
    expect(() => registry.select({ kind: 'stimulus', activities: [] })).toThrow('at least one');
    expect(() =>
      registry.select({ kind: 'stimulus', activities: [activities[0], activities[0]] }),
    ).toThrow('duplicate');
    expect(() => registry.select({ kind: 'stimulus', activities })).toThrow('eight traces');
  });

  it('bounds the registry and requires nonempty owning identities', () => {
    expect(() => createActivityRegistry({ ...identity, executionId: ' ' })).toThrow('identity');
    const registry = createActivityRegistry(identity);
    for (let index = 0; index < 256; index++) {
      registry.begin({ purpose: 'setup', name: 'setup' });
    }
    expect(() => registry.begin({ purpose: 'stimulus', name: 'overflow' })).toThrow(
      'registration limit',
    );
  });
});
