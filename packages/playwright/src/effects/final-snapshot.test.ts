import type { TestInfo } from '@playwright/test';
import { describe, expect, it } from 'vitest';

import { createActivityRegistry } from '../activities/activity-registry.js';
import { identity, payload, snapshot, span } from '../activities/observations.fixture.js';
import {
  admitSnapshot,
  type ScopedObservationReadResult,
} from '../activities/scoped-observations.js';
import { AttemptReport } from '../reporting/attempt.js';
import { digestBytes } from '../envelope/index.js';
import {
  buildFinalSnapshot,
  finalSnapshotAttachment,
  type CollectorFinalization,
  type FinalSnapshotInput,
} from './final-snapshot.js';

const clean = {
  state: 'found',
  receiver: 'stopped',
  shutdown: 'complete',
  acceptedRequests: 3,
  acceptedSpans: 4,
  activatedServices: ['api'],
  failure: null,
} satisfies CollectorFinalization;
const passed = {
  testId: 'test-1',
  retry: 0,
  status: 'passed',
  expectedStatus: 'passed',
  errorCount: 0,
  stopReason: 'completed',
};

function admitted(): ScopedObservationReadResult {
  const registry = createActivityRegistry(identity);
  const stimulus = registry.begin({ purpose: 'stimulus', name: 'create' });
  const selection = registry.select({ kind: 'stimulus', activities: [stimulus] });
  const result = admitSnapshot(
    snapshot([{ traceId: stimulus.context.traceId, payload: payload([span(stimulus)]) }]),
    selection,
  );
  if (result.kind !== 'admitted') {
    throw new Error('fixture must be admitted');
  }
  return result;
}

function input(overrides: Partial<FinalSnapshotInput> = {}): FinalSnapshotInput {
  return {
    attempt: passed,
    collector: clean,
    stimuli: [{ activityId: 'a-1', purpose: 'stimulus' }],
    read: admitted(),
    ...overrides,
  };
}

describe('final snapshot', () => {
  it('records the observed effects but never turns a clean shutdown into demonstrated completeness', () => {
    const document = buildFinalSnapshot(input());
    expect(document.observation.state).toBe('admitted');
    expect(document.observation.observedServices).toEqual(['api']);
    expect(document.finalization.collector).toEqual(clean);
    expect(document.completeness).toMatchObject({
      status: 'not-demonstrated',
      closed: false,
      attestation: 'none',
      finalizationImpliesCompleteness: false,
    });
    expect(document.completeness.reasons).toContain('no-harness-completeness-attestation');
    expect(document.completeness.reasons.some((reason) => reason.startsWith('collector-'))).toBe(
      false,
    );
    expect(document.evidence).toMatchObject({ kind: 'admitted' });
    expect(document.evidence).not.toHaveProperty('assessment');
  });

  it('names a service that was activated but contributed nothing, without calling it absent', () => {
    const document = buildFinalSnapshot(
      input({ collector: { ...clean, activatedServices: ['api', 'orders'] } }),
    );
    expect(document.observation.activatedWithoutObservation).toEqual(['orders']);
    expect(document.completeness.reasons).toContain('activated-without-observation:orders');
    expect(document.completeness.status).toBe('not-demonstrated');
  });

  it('reports no completed stimulus as its own state, not as an empty snapshot', () => {
    const document = buildFinalSnapshot(input({ stimuli: null, read: null }));
    expect(document.stimuli).toEqual({ state: 'none', activities: [] });
    expect(document.observation.state).toBe('no-stimulus');
    expect(document.completeness.status).toBe('unavailable');
    expect(document.evidence).toEqual({ kind: 'not-admitted' });
  });

  it.each(['unavailable', 'rejected'] as const)('keeps a %s read explicit', (kind) => {
    const document = buildFinalSnapshot(input({ read: { kind, message: 'no snapshot' } }));
    expect(document.observation).toMatchObject({
      state: kind,
      message: 'no snapshot',
      payloadCount: 0,
    });
    expect(document.completeness.status).toBe('unavailable');
    expect(document.completeness.reasons).toContain(`observation-${kind}`);
    expect(document.evidence).toEqual({ kind: 'not-admitted' });
  });

  it('keeps a projection the effects engine rejects explicit', () => {
    const read = admitted();
    if (read.kind !== 'admitted') {
      throw new Error('fixture must be admitted');
    }
    const [first] = read.payloads as [ReturnType<typeof payload>];
    const conflicting = structuredClone(first);
    conflicting.resourceSpans[0].resource.attributes[0].value.stringValue = 'other-service';
    const document = buildFinalSnapshot(
      input({ read: { ...read, payloads: [first, conflicting] } }),
    );
    expect(document.observation.state).toBe('projection-rejected');
    expect(document.evidence).toEqual({ kind: 'not-admitted' });
  });
});

describe('final snapshot states', () => {
  it('records failed, interrupted and timed-out attempts and flags the last two as unfinished', () => {
    const failed = buildFinalSnapshot(
      input({ attempt: { ...passed, status: 'failed', errorCount: 2, stopReason: 'failed' } }),
    );
    expect(failed.attempt).toMatchObject({ status: 'failed', errorCount: 2 });
    expect(failed.observation.state).toBe('admitted');
    for (const status of ['interrupted', 'timedOut']) {
      const document = buildFinalSnapshot(input({ attempt: { ...passed, status } }));
      expect(document.completeness.reasons).toContain(`attempt-${status}`);
    }
  });

  it('marks a collector that did not finish stopping, or left no lifecycle, as such', () => {
    const draining = buildFinalSnapshot(
      input({ collector: { ...clean, shutdown: 'timed-out', receiver: 'draining' } }),
    );
    expect(draining.completeness.reasons).toEqual(
      expect.arrayContaining(['collector-shutdown-timed-out', 'collector-receiver-draining']),
    );
    const missing = buildFinalSnapshot(
      input({ collector: { state: 'missing', message: 'none retained' } }),
    );
    expect(missing.completeness.reasons).toContain('collector-lifecycle-missing');
    expect(missing.observation.activatedWithoutObservation).toEqual([]);
  });

  it('lists activity traces the collector never received', () => {
    const read = admitted();
    if (read.kind !== 'admitted') {
      throw new Error('fixture must be admitted');
    }
    const document = buildFinalSnapshot(
      input({
        read: {
          ...read,
          diagnostics: [...read.diagnostics, 'activity-trace-not-received:a-1:t-1'],
        },
      }),
    );
    expect(document.observation.missingActivityTraces).toEqual([
      'activity-trace-not-received:a-1:t-1',
    ]);
    expect(document.completeness.reasons).toContain('activity-trace-not-received');
  });

  it('is deterministic for equal inputs', () => {
    const read = admitted();
    expect(JSON.stringify(buildFinalSnapshot(input({ read })))).toBe(
      JSON.stringify(buildFinalSnapshot(input({ read }))),
    );
  });
});

describe('final snapshot attachment', () => {
  it('attaches under its own name, keeps retries distinct and redacts protected values', async () => {
    const attachments: { readonly name: string; readonly body: string }[] = [];
    const testInfo = {
      attach: (name: string, options: { readonly body: string }) => {
        attachments.push({ name, body: options.body });
        return Promise.resolve();
      },
    } as TestInfo;
    const report = new AttemptReport(testInfo);
    report.protect({ token: 'synthetic-secret' });
    const first = buildFinalSnapshot(
      input({ read: { kind: 'unavailable', message: 'token=synthetic-secret' } }),
    );
    const second = buildFinalSnapshot(input({ attempt: { ...passed, retry: 1 } }));
    await report.finalSnapshot(first);
    await report.finalSnapshot(second);
    expect(attachments.map(({ name }) => name)).toEqual([
      finalSnapshotAttachment,
      finalSnapshotAttachment,
    ]);
    expect(attachments.map(({ body }) => body).join('\n')).not.toContain('synthetic-secret');
    const documents = attachments.map(
      ({ body }) => JSON.parse(body) as { attempt: { retry: number }; kind: string },
    );
    expect(documents.map((document) => document.attempt.retry)).toEqual([0, 1]);
    expect(documents.every((document) => document.kind === 'final-snapshot')).toBe(true);
  });
});

describe('attached evidence digests', () => {
  it('records the digest of the exact body each attachment carried', async () => {
    const bodies: string[] = [];
    const testInfo = {
      attach: (_name: string, options: { readonly body: string }) => {
        bodies.push(options.body);
        return Promise.resolve();
      },
    } as TestInfo;
    const report = new AttemptReport(testInfo);
    await report.finalSnapshot(buildFinalSnapshot(input()));
    const [attached] = report.attachedEvidence();
    expect(attached).toMatchObject({ kind: 'final-snapshot', name: finalSnapshotAttachment });
    expect(attached.digest).toBe(digestBytes(bodies[0] ?? ''));
    expect(attached.bytes).toBe(Buffer.byteLength(bodies[0] ?? ''));
  });
});
