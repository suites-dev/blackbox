import { access, rm } from 'node:fs/promises';

import { describe, expect as check, it } from 'vitest';

import { compileEffectContract, type EffectContractBuilder } from '../contract.js';
import { expect } from '../expect.js';
import { evaluateBlackboxEffects } from '../runtime.js';
import { createScopedBlackboxEffects } from '../scoped-effects.js';
import { operationSpan, withPipeline, type PipelineFixture } from './collector.fixture.js';

describe('collector-backed effects assertions', () => {
  describe('registered stimulus', () => {
    it('projects retained OTLP through the real evaluator into the public matcher', async () => {
      await withPipeline(async ({ registry, storageDirectory, exportSpans }) => {
        const action = registry.begin({ purpose: 'stimulus', name: 'create an order' });
        const effects = createScopedBlackboxEffects({
          storageDirectory,
          selection: registry.select({ kind: 'stimulus', activities: [action] }),
        });
        await exportSpans([
          operationSpan({
            traceId: action.context.traceId,
            spanId: '1111111111111111',
            attributes: { 'http.request.method': 'POST', 'http.route': '/orders' },
          }),
          operationSpan({
            traceId: action.context.traceId,
            spanId: '2222222222222222',
            attributes: { 'db.system.name': 'postgresql', 'db.operation.name': 'INSERT' },
          }),
        ]);
        await expect(effects).toSatisfy((e) => [
          e.exists(e.http({ method: 'POST', route: '/orders' })),
          e.atLeast(1, e.db({ operation: 'INSERT' })),
        ]);
        await check(
          expect(effects).toSatisfy((e) => [e.absent(e.db({ operation: 'INSERT' }))]),
        ).rejects.toThrow();
        await expect(effects).not.toSatisfy((e) => [e.absent(e.db({ operation: 'INSERT' }))]);
      });
    });
  });
});

describe('activity purpose separation', () => {
  it('excludes state inspection until an explicit procedure union selects it', async () => {
    await withPipeline(async ({ registry, storageDirectory, exportSpans }) => {
      const stimulus = registry.begin({ purpose: 'stimulus', name: 'create an order' });
      const inspection = registry.begin({ purpose: 'inspection', name: 'read durable state' });
      await exportSpans([
        operationSpan({
          traceId: stimulus.context.traceId,
          spanId: '1111111111111111',
          attributes: { 'db.system.name': 'postgresql', 'db.operation.name': 'INSERT' },
        }),
        operationSpan({
          traceId: inspection.context.traceId,
          spanId: '2222222222222222',
          attributes: { 'db.system.name': 'postgresql', 'db.operation.name': 'SELECT' },
        }),
      ]);
      const effects = createScopedBlackboxEffects({
        storageDirectory,
        selection: registry.select({ kind: 'stimulus', activities: [stimulus] }),
      });
      const readContract: EffectContractBuilder = (e) => [e.exists(e.db({ operation: 'SELECT' }))];
      check(
        await evaluateBlackboxEffects(effects, compileEffectContract(readContract)),
      ).toMatchObject({ kind: 'inconclusive' });
      await check(expect(effects).toSatisfy(readContract)).rejects.toThrow();
      await check(expect(effects).not.toSatisfy(readContract)).rejects.toThrow();
      const procedure = createScopedBlackboxEffects({
        storageDirectory,
        selection: registry.select({ kind: 'procedure', activities: [stimulus, inspection] }),
      });
      await expect(procedure).toSatisfy(readContract);
    });
  });
});

describe('fixed activity membership', () => {
  it('does not broaden an existing handle when another stimulus is registered', async () => {
    await withPipeline(async ({ registry, storageDirectory, exportSpans }) => {
      const first = registry.begin({ purpose: 'stimulus', name: 'create an order' });
      const effects = createScopedBlackboxEffects({
        storageDirectory,
        selection: registry.select({ kind: 'stimulus', activities: [first] }),
      });
      const later = registry.begin({ purpose: 'stimulus', name: 'update another order' });
      await exportSpans([
        operationSpan({
          traceId: first.context.traceId,
          spanId: '1111111111111111',
          attributes: { 'db.system.name': 'postgresql', 'db.operation.name': 'INSERT' },
        }),
        operationSpan({
          traceId: later.context.traceId,
          spanId: '2222222222222222',
          attributes: { 'db.system.name': 'postgresql', 'db.operation.name': 'UPDATE' },
        }),
      ]);
      const update = compileEffectContract((e) => [e.exists(e.db({ operation: 'UPDATE' }))]);
      check(await evaluateBlackboxEffects(effects, update)).toMatchObject({ kind: 'inconclusive' });
      await expect(effects).toSatisfy((e) => [e.exists(e.db({ operation: 'INSERT' }))]);
      const combined = createScopedBlackboxEffects({
        storageDirectory,
        selection: registry.select({ kind: 'stimulus', activities: [first, later] }),
      });
      await expect(combined).toSatisfy((e) => [e.exists(e.db({ operation: 'UPDATE' }))]);
    });
  });
});

describe('incomplete observations', () => {
  it('keeps missing telemetry inconclusive under positive and negated assertions', async () => {
    await withPipeline(async ({ registry, storageDirectory }) => {
      const action = registry.begin({ purpose: 'stimulus', name: 'unexported action' });
      const effects = createScopedBlackboxEffects({
        storageDirectory,
        selection: registry.select({ kind: 'stimulus', activities: [action] }),
      });
      const contract = compileEffectContract((e) => [e.exists(e.http())]);
      check(await evaluateBlackboxEffects(effects, contract)).toMatchObject({
        kind: 'inconclusive',
      });
      await check(expect(effects).toSatisfy((e) => [e.exists(e.http())])).rejects.toThrow();
      await check(expect(effects).not.toSatisfy((e) => [e.exists(e.http())])).rejects.toThrow();
    });
  });

  it('does not treat collector shutdown as proof of complete application telemetry', async () => {
    await withPipeline(async ({ registry, storageDirectory, collector, exportSpans }) => {
      const action = registry.begin({ purpose: 'stimulus', name: 'one observed write' });
      await exportSpans([
        operationSpan({
          traceId: action.context.traceId,
          spanId: '1111111111111111',
          attributes: { 'db.system.name': 'postgresql', 'db.operation.name': 'INSERT' },
        }),
      ]);
      check((await collector.close()).kind).toBe('collector-stopped');
      const effects = createScopedBlackboxEffects({
        storageDirectory,
        selection: registry.select({ kind: 'stimulus', activities: [action] }),
      });
      await expect(effects).toSatisfy((e) => [e.atLeast(1, e.db({ operation: 'INSERT' }))]);
      const exact = compileEffectContract((e) => [e.exactly(1, e.db({ operation: 'INSERT' }))]);
      check(await evaluateBlackboxEffects(effects, exact)).toMatchObject({ kind: 'inconclusive' });
      await check(
        expect(effects).not.toSatisfy((e) => [e.exactly(1, e.db({ operation: 'INSERT' }))]),
      ).rejects.toThrow();
    });
  });
});

describe('pipeline fixture cleanup', () => {
  it('closes the receiver and removes owned storage even when an assertion fails', async () => {
    const captured: PipelineFixture[] = [];
    await check(
      withPipeline((fixture) => {
        captured.push(fixture);
        return Promise.reject(new Error('deliberate assertion failure'));
      }),
    ).rejects.toThrow('deliberate assertion failure');
    const fixture = captured.at(0);
    if (fixture === undefined) {
      throw new Error('Collector fixture did not execute');
    }
    try {
      await check(
        fetch(fixture.collector.endpoint.readinessUrl, {
          signal: AbortSignal.timeout(1_000),
        }),
      ).rejects.toThrow();
      await check(access(fixture.storageDirectory)).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await fixture.collector.close();
      await rm(fixture.storageDirectory, { recursive: true, force: true });
    }
  });
});
