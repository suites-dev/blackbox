import type { CollectorSnapshotReadResult } from '@suites/blackbox-otel-collector';
import { describe, expect, it, vi } from 'vitest';

import { createActivityRegistry } from './activity-registry.js';
import { identity, payload, snapshot, span } from './observations.fixture.js';
import { createScopedObservationSource } from './scoped-observations.js';
import type { ActivitySelection } from './types.js';

function source(selection: ActivitySelection, captured: CollectorSnapshotReadResult) {
  const readSnapshot = vi.fn().mockResolvedValue(captured);
  return {
    source: createScopedObservationSource(
      { selection, storageDirectory: '/owned/collector' },
      { readSnapshot },
    ),
    readSnapshot,
  };
}

function boundary() {
  const registry = createActivityRegistry(identity);
  const stimulus = registry.begin({ purpose: 'stimulus', name: 'create' });
  const inspection = registry.begin({ purpose: 'inspection', name: 'read' });
  const selected = registry.select({ kind: 'stimulus', activities: [stimulus] });
  return { registry, stimulus, inspection, selected };
}

describe('scoped collector observation admission', () => {
  it('retains unmarked child spans by registered trace and excludes inspection without reading it as stimulus', async () => {
    const { stimulus, inspection, selected } = boundary();
    const raw = payload([span(stimulus), span(stimulus, '2222222222222222')]);
    const capture = snapshot([
      { traceId: stimulus.context.traceId, payload: raw },
      { traceId: inspection.context.traceId, payload: payload([span(inspection)]) },
    ]);
    const reader = source(selected, capture);
    const result = await reader.source.read();
    expect(reader.readSnapshot).toHaveBeenCalledExactlyOnceWith({
      ...identity,
      storageDirectory: '/owned/collector',
    });
    expect(result.kind).toBe('admitted');
    if (result.kind !== 'admitted') {
      throw new Error('Expected admitted child observations.');
    }
    expect(result.payloads).toEqual([raw]);
    expect(Object.keys(result.provenance)).toHaveLength(2);
    expect(
      Object.values(result.provenance)
        .flat()
        .map((origin) => origin.activityId),
    ).toEqual([stimulus.activityId, stimulus.activityId]);
    expect(result).not.toHaveProperty('coverage');
    expect(result).not.toHaveProperty('closed');
    expect(Object.isFrozen(result.payloads[0])).toBe(true);
    expect(Object.isFrozen(raw)).toBe(false);
    expect(Object.isFrozen(result.provenance)).toBe(true);
  });

  it('permits a declared procedure union with exact witness ownership', async () => {
    const { registry, stimulus, inspection } = boundary();
    const selected = registry.select({ kind: 'procedure', activities: [stimulus, inspection] });
    const capture = snapshot(
      [stimulus, inspection].map((activity) => ({
        traceId: activity.context.traceId,
        payload: payload([span(activity)]),
      })),
    );
    const result = await source(selected, capture).source.read();
    expect(result.kind).toBe('admitted');
    if (result.kind !== 'admitted') {
      throw new Error('Expected explicit procedure evidence.');
    }
    expect(result.payloads).toHaveLength(2);
    expect(result.provenance[`${inspection.context.traceId}:1111111111111111`][0]).toMatchObject({
      activityId: inspection.activityId,
      purpose: 'inspection',
      ...identity,
    });
  });
});

describe('scope admission rejection boundaries', () => {
  it.each(['sessionId', 'executionId'] as const)(
    'rejects a different %s before returning any payload',
    async (key) => {
      const { stimulus, selected } = boundary();
      const capture = snapshot([
        { traceId: stimulus.context.traceId, payload: payload([span(stimulus)]) },
      ]);
      const result = await source(selected, {
        ...capture,
        identity: { ...identity, [key]: 'foreign' },
      }).source.read();
      expect(result).toMatchObject({
        kind: 'rejected',
        message: expect.stringContaining('identity'),
      });
      expect(result).not.toHaveProperty('payloads');
    },
  );

  it('rejects an inspection span smuggled under the selected trace label atomically, including procedure selection', async () => {
    const { registry, stimulus, inspection, selected } = boundary();
    const capture = snapshot([
      { traceId: stimulus.context.traceId, payload: payload([span(stimulus), span(inspection)]) },
      { traceId: inspection.context.traceId, payload: payload([span(inspection)]) },
    ]);
    for (const selection of [
      selected,
      registry.select({ kind: 'procedure', activities: [stimulus, inspection] }),
    ]) {
      const result = await source(selection, capture).source.read();
      expect(result).toMatchObject({
        kind: 'rejected',
        message: expect.stringContaining('Foreign span trace'),
      });
      expect(result).not.toHaveProperty('payloads');
      expect(result).not.toHaveProperty('provenance');
    }
  });

  it('rejects conflicting and duplicate activity markers on an otherwise admitted trace', async () => {
    const { stimulus, inspection, selected } = boundary();
    const valid = { key: 'blackbox.activity.id', value: { stringValue: stimulus.activityId } };
    for (const attributes of [
      [{ ...valid, value: { stringValue: inspection.activityId } }],
      [valid, valid],
      [{ key: 'blackbox.activity.purpose', value: { stringValue: 'inspection' } }],
    ]) {
      const capture = snapshot([
        {
          traceId: stimulus.context.traceId,
          payload: payload([{ ...span(stimulus), attributes }]),
        },
      ]);
      expect(await source(selected, capture).source.read()).toMatchObject({
        kind: 'rejected',
        message: expect.stringContaining('marker'),
      });
    }
  });
});

describe('scope admission uncertainty and loss preservation', () => {
  it('does not make a copied selection trusted by handing it to the reader', () => {
    const { selected } = boundary();
    expect(() => source(structuredClone(selected), snapshot([]))).toThrow('not owned');
  });

  it('keeps an absent selected trace empty and unknown even after successful activity completion', async () => {
    const { registry, stimulus, selected } = boundary();
    registry.finish(stimulus, { kind: 'telemetry-scope-succeeded' });
    const result = await source(selected, snapshot([])).source.read();
    expect(result).toMatchObject({ kind: 'admitted', payloads: [], provenance: {} });
    if (result.kind !== 'admitted') {
      throw new Error('Expected empty admitted selection.');
    }
    expect(result.diagnostics).toContain(
      `activity-trace-not-received:${stimulus.activityId}:${stimulus.context.traceId}`,
    );
    expect(result).not.toHaveProperty('attestation');
  });

  it('distinguishes unavailable collection from rejected corruption', async () => {
    const { selected } = boundary();
    const missing = {
      kind: 'collector-snapshot-missing',
      identity,
      message: 'not retained',
    } satisfies CollectorSnapshotReadResult;
    expect(await source(selected, missing).source.read()).toMatchObject({ kind: 'unavailable' });
    const corrupt = {
      kind: 'collector-snapshot-corrupt',
      identity,
      error: { name: 'Error', message: 'corrupt record' },
    } satisfies CollectorSnapshotReadResult;
    expect(await source(selected, corrupt).source.read()).toMatchObject({ kind: 'rejected' });
    const reader = createScopedObservationSource(
      { selection: selected, storageDirectory: '/owned/collector' },
      {
        readSnapshot: () => Promise.reject(new Error('read failed')),
      },
    );
    expect(await reader.read()).toMatchObject({ kind: 'unavailable' });
  });

  it('preserves duplicate arrivals, dropped-data fields and raw resource fields for normalization', async () => {
    const { stimulus, selected } = boundary();
    const dropped = { ...span(stimulus), droppedAttributesCount: 2 };
    const raw = payload([dropped, structuredClone(dropped)]);
    const result = await source(
      selected,
      snapshot([{ traceId: stimulus.context.traceId, payload: raw }]),
    ).source.read();
    expect(result).toMatchObject({ kind: 'admitted', payloads: [raw] });
    if (result.kind !== 'admitted') {
      throw new Error('Expected unchanged loss metadata.');
    }
    expect(Object.keys(result.provenance)).toHaveLength(1);
  });
});

describe('scope admission input bounds', () => {
  it('rejects malformed nested collections and invalid span identities', async () => {
    const { stimulus, selected } = boundary();
    for (const raw of [
      { resourceSpans: [{ scopeSpans: null }] },
      payload([{ ...span(stimulus), spanId: '0000000000000000' }]),
    ]) {
      const result = await source(
        selected,
        snapshot([{ traceId: stimulus.context.traceId, payload: raw }]),
      ).source.read();
      expect(result.kind).toBe('rejected');
    }
  });

  it('rejects over-limit records, selected bytes and span identity counts without truncation', async () => {
    const { stimulus, selected } = boundary();
    for (const raw of [
      payload([{ ...span(stimulus), padding: 'x'.repeat(33 * 1024) }]),
      { ...payload([span(stimulus)]), padding: 'x'.repeat(256 * 1024) },
      payload(
        Array.from({ length: 257 }, (_, index) =>
          span(stimulus, (index + 1).toString(16).padStart(16, '0')),
        ),
      ),
    ]) {
      const result = await source(
        selected,
        snapshot([{ traceId: stimulus.context.traceId, payload: raw }]),
      ).source.read();
      expect(result.kind).toBe('rejected');
      expect(result).not.toHaveProperty('payloads');
    }
  });
});
