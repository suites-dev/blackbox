import { expect, it } from 'vitest';
import type { EffectAssessment, EffectGraph } from '@suites/blackbox-effects';

import type { ActivityProvenance, ActivitySelection } from '../../activities/types.js';
import type { ScopedObservationReadResult } from '../../activities/scoped-observations.js';
import { createEffectEvidenceArtifact } from './artifact.js';

function span(index: number): Record<string, unknown> {
  const suffix = index.toString(16).padStart(16, '0');
  return {
    traceId: suffix.padStart(32, '0'),
    spanId: suffix,
    kind: 3,
    status: { code: 1 },
    attributes: [
      { key: 'http.method', value: { stringValue: 'POST' } },
      { key: 'http.route', value: { stringValue: '/payments' } },
      { key: 'http.request.header.authorization', value: { stringValue: 'Bearer raw-secret' } },
      { key: 'db.statement', value: { stringValue: 'SELECT raw-secret' } },
    ],
  };
}

function payload(spans: readonly Record<string, unknown>[]): Record<string, unknown> {
  return {
    resourceSpans: [
      {
        resource: {
          attributes: [{ key: 'service.name', value: { stringValue: 'payments' } }],
        },
        scopeSpans: [{ spans }],
      },
    ],
  };
}

function fixture() {
  const spans = Array.from({ length: 130 }, (_, index) => span(index + 1));
  const first = spans[0];
  const traceId = String(first.traceId);
  const spanId = String(first.spanId);
  const selection = {
    scopeId: 'scope-1',
    sessionId: 'session-1',
    executionId: 'execution-1',
    kind: 'stimulus',
    activities: [
      { activityId: 'activity-1', purpose: 'stimulus', traceIds: [traceId] },
    ],
  } satisfies ActivitySelection;
  const provenance = {
    [`${traceId}:${spanId}`]: [
      {
        sessionId: 'session-1',
        executionId: 'execution-1',
        activityId: 'activity-1',
        purpose: 'stimulus',
        traceId,
        spanId,
      },
    ],
  } satisfies Readonly<Record<string, readonly ActivityProvenance[]>>;
  const graph = {
    schemaVersion: '0.1.1',
    scope: { id: 'scope-1', closed: false },
    quality: {
      coverage: 'unknown',
      orderCoverage: 'unknown',
      reasons: ['open capture'],
      attestation: 'none',
    },
    effects: [
      {
        id: 'effect-1',
        kind: 'http',
        operation: 'POST',
        target: '/payments',
        actor: 'payments',
        outcome: 'unknown',
        attributes: { 'unreported.secret': 'raw-secret' },
        source: [{ traceId, spanId }],
      },
    ],
    relations: [],
  } satisfies EffectGraph;
  const assessment = {
    status: 'pass',
    scope: 'scope-1',
    semanticsVersion: '0.1.0',
    findings: [{ index: 0, status: 'pass', reason: 'witness', evidence: ['effect-1'] }],
  } satisfies EffectAssessment;
  const read = {
    kind: 'admitted',
    scopeId: 'scope-1',
    payloads: [payload([{ attributes: [] }, ...spans])],
    diagnostics: ['explicit admission'],
    scope: selection,
    provenance,
  } satisfies ScopedObservationReadResult;

  return {
    traceId,
    spanId,
    artifact: createEffectEvidenceArtifact({
      read,
      graph,
      assessment,
    }),
  };
}

it('combines bounded safe observations, projection, findings, and activity ownership', () => {
  const { artifact, traceId, spanId } = fixture();

  expect(artifact.observations.excerpts).toHaveLength(128);
  expect(artifact.omitted.observations).toBe(2);
  expect(artifact.observations.excerpts[0]).toMatchObject({
    traceId,
    spanId,
    service: 'payments',
    kind: '3',
    status: '1',
    fields: [
      { key: 'http.method', value: 'POST' },
      { key: 'http.route', value: '/payments' },
    ],
  });
  expect(JSON.stringify(artifact)).not.toContain('authorization');
  expect(JSON.stringify(artifact)).not.toContain('db.statement');
  expect(JSON.stringify(artifact)).not.toContain('unreported.secret');
  expect(artifact.projection.effects[0]).toMatchObject({ id: 'effect-1', target: '/payments' });
  expect(artifact.assessment.findings[0]).toMatchObject({ evidence: ['effect-1'] });
  expect(artifact.ownership[0]).toMatchObject({
    effectId: 'effect-1',
    observations: [{ owners: [{ activityId: 'activity-1', purpose: 'stimulus' }] }],
  });
});
