import { describe, expect, it } from 'vitest';

import { buildEnvelope } from '../build.js';
import { digestBytes } from '../canonical.js';
import {
  collector,
  configurationFixture,
  envelopeFixture,
  inputFixture,
  snapshotFixture,
  sourceFixture,
} from './envelope.fixture.js';
import { verifyEnvelope } from '../verify.js';

const attempt = (id: string, retry = 0) => ({
  attemptId: id,
  executionId: id,
  sessionId: `session-${id}`,
  retry,
  retries: 1,
});

describe('two executions of one scenario', () => {
  it('share behavior, experiment, configuration, source and observation but not identity or digest', () => {
    const first = envelopeFixture({ attempt: attempt('attempt-1') });
    const second = envelopeFixture({
      attempt: attempt('attempt-2'),
      provenance: { ...inputFixture().provenance, capturedAt: '2026-02-02T00:00:00.000Z' },
    });
    expect(second.identity.behavior).toEqual(first.identity.behavior);
    expect(second.identity.experiment).toBe(first.identity.experiment);
    expect(second.identity.observation).toBe(first.identity.observation);
    expect(second.configuration.fingerprint).toBe(first.configuration.fingerprint);
    expect(second.source.fingerprint).toBe(first.source.fingerprint);
    expect(second.identity.attempt.attemptId).not.toBe(first.identity.attempt.attemptId);
    expect(second.digest).not.toBe(first.digest);
    expect(verifyEnvelope(first)).toEqual({ ok: true });
    expect(verifyEnvelope(second)).toEqual({ ok: true });
  });

  it('keeps a failed attempt and its passing retry as two independent, verifiable documents', () => {
    const failed = envelopeFixture({
      attempt: attempt('attempt-1', 0),
      testStatus: { status: 'failed', expectedStatus: 'passed', errorCount: 1 },
    });
    const retried = envelopeFixture({ attempt: attempt('attempt-2', 1) });
    expect(failed.verification.testStatus.status).toBe('failed');
    expect(retried.verification.testStatus.status).toBe('passed');
    expect(failed.digest).not.toBe(retried.digest);
    expect(failed.identity.attempt.retry).toBe(0);
    expect(retried.identity.attempt.retry).toBe(1);
    expect(failed.identity.experiment).toBe(retried.identity.experiment);
    expect(verifyEnvelope(failed)).toEqual({ ok: true });
  });
});

describe('what changes the identity', () => {
  it('a catalog change alters the configuration fingerprint and the experiment, not the behavior', () => {
    const base = envelopeFixture();
    const changed = envelopeFixture({
      configuration: configurationFixture({ compose: 'compose-v2' }),
    });
    expect(changed.identity.behavior).toEqual(base.identity.behavior);
    expect(changed.configuration.catalog.digest).not.toBe(base.configuration.catalog.digest);
    expect(changed.configuration.fingerprint).not.toBe(base.configuration.fingerprint);
    expect(changed.identity.experiment).not.toBe(base.identity.experiment);
  });

  it('a dirty working tree differs from its commit even though the commit is the same', () => {
    const clean = envelopeFixture();
    const dirty = envelopeFixture({
      source: sourceFixture({
        commit: 'c1',
        workingTree: { state: 'dirty', digest: digestBytes('edit'), coverage: 'complete' },
      }),
    });
    expect(dirty.source.commit).toBe(clean.source.commit);
    expect(dirty.source.fingerprint).not.toBe(clean.source.fingerprint);
  });

  it('records an unavailable source as unavailable, with no fingerprint to compare', () => {
    const envelope = envelopeFixture({
      source: {
        state: 'unavailable',
        repoId: null,
        commit: null,
        tree: null,
        workingTree: { state: 'unknown', reason: 'not-a-git-repository' },
        fingerprint: null,
        reason: 'not-a-git-repository',
      },
    });
    expect(envelope.source.fingerprint).toBeNull();
    expect(verifyEnvelope(envelope)).toEqual({ ok: true });
  });
});

describe('observation, expectation and verification stay apart', () => {
  it('lists expected, activated and observed participants without turning a gap into an assertion', () => {
    const envelope = envelopeFixture();
    const status = Object.fromEntries(
      envelope.observed.coverage.participants.map(({ id, status: value }) => [id, value]),
    );
    expect(status).toEqual({
      api: 'observed',
      worker: 'activated-without-observation',
      db: 'unconfigured',
    });
    expect(envelope.observed.coverage.gaps).toEqual(['activated-without-observation:worker']);
    expect(envelope.verification.assertions).toEqual([]);
    expect(envelope.expectations).toEqual({
      acceptedBaselines: [],
      acceptedContracts: [],
      declaredInTest: [],
    });
    expect(envelope.observed.completeness.closed).toBe(false);
  });
});

describe('coverage and the v0 wrapper', () => {
  it('marks a participant that was configured but never activated, and one with no lifecycle as unknown', () => {
    const notActivated = envelopeFixture({
      snapshot: snapshotFixture({ collector: { ...collector, activatedServices: ['api'] } }),
    });
    expect(notActivated.observed.coverage.gaps).toContain('configured-not-activated:worker');
    const unknown = envelopeFixture({
      snapshot: snapshotFixture({ collector: { state: 'missing', message: 'none' } }),
    });
    expect(unknown.observed.coverage.participants.map(({ status }) => status)).toEqual([
      'unknown',
      'unknown',
      'unconfigured',
    ]);
  });

  it('wraps the v0 record unchanged, always incomplete, and omits it when nothing was admitted', () => {
    const envelope = envelopeFixture();
    expect(envelope.observed.effectsRecord).toMatchObject({
      schemaVersion: 0,
      source: { kind: 'playwright-attempt', id: 'attempt-1' },
      completeness: { status: 'incomplete' },
    });
    expect(envelope.observed.effectsRecord).toMatchObject({
      effects: [
        { kind: 'http', operation: 'POST', target: 'unknown', outcome: 'unknown', count: 1 },
      ],
    });
    const none = envelopeFixture({ snapshot: null, snapshotEvidence: null });
    expect(none.observed.effectsRecord).toBeNull();
    expect(none.observed.effectsRecordReason).toBe('no-final-snapshot');
    expect(none.observed.finalSnapshot).toEqual({
      state: 'not-produced',
      reason: 'no-final-snapshot',
    });
    expect(none.identity.observation).toBeNull();
    expect(verifyEnvelope(none)).toEqual({ ok: true });
  });

  it('carries assertion results as verification and their contracts as test-declared, never accepted', () => {
    const evidence = digestBytes('assertion-body');
    const contract = digestBytes('contract');
    const envelope = envelopeFixture({
      assertions: [
        {
          sequence: 1,
          outcome: 'failed',
          evaluation: 'unsatisfied',
          contractDigest: contract,
          evidence,
        },
      ],
      evidence: [
        ...inputFixture().evidence,
        {
          id: evidence,
          kind: 'assertion-evidence',
          bytes: 9,
          locator: { type: 'attachment', name: 'blackbox-effects', sequence: 1 },
        },
      ],
    });
    expect(envelope.verification.assertions.map(({ outcome }) => outcome)).toEqual(['failed']);
    expect(envelope.expectations.declaredInTest).toEqual([
      { contractDigest: contract, assertions: 1 },
    ]);
    expect(envelope.expectations.acceptedContracts).toEqual([]);
    expect(verifyEnvelope(envelope)).toEqual({ ok: true });
  });
});

describe('content addressing', () => {
  it('keeps volatile provenance in the document digest but out of every fingerprint', () => {
    const base = envelopeFixture();
    const moved = envelopeFixture({
      provenance: {
        ...inputFixture().provenance,
        test: { ...inputFixture().provenance.test, file: 'moved.spec.ts' },
        source: { branch: 'topic', changedPaths: [] },
      },
    });
    expect(moved.digest).not.toBe(base.digest);
    expect(moved.identity).toEqual(base.identity);
    expect(moved.configuration.fingerprint).toBe(base.configuration.fingerprint);
    expect(moved.source.fingerprint).toBe(base.source.fingerprint);
  });

  it('is deterministic and independent of evidence order', () => {
    const input = inputFixture();
    const extra = {
      id: digestBytes('x'),
      kind: 'sandbox-record' as const,
      bytes: 1,
      locator: { type: 'file' as const, root: 'test-output' as const, path: 'x' },
    };
    const forward = buildEnvelope({ ...input, evidence: [...input.evidence, extra] });
    const reversed = buildEnvelope({ ...input, evidence: [extra, ...input.evidence] });
    expect(reversed.digest).toBe(forward.digest);
  });

  it('detects tampering with any field, including a recomputed inner digest', () => {
    const envelope = envelopeFixture();
    const edited = { ...envelope, source: { ...envelope.source, commit: 'other' } };
    const result = verifyEnvelope(edited);
    expect(result.ok).toBe(false);
    const forged = {
      ...envelope,
      expectations: { ...envelope.expectations, acceptedBaselines: ['baseline'] },
    };
    const forgedResult = verifyEnvelope(forged);
    expect(forgedResult.ok).toBe(false);
    if (!forgedResult.ok) {
      expect(forgedResult.problems).toContain('expectations.acceptedBaselines');
    }
    expect(verifyEnvelope({ kind: 'behavior-envelope', envelopeVersion: 2 }).ok).toBe(false);
    expect(verifyEnvelope(null).ok).toBe(false);
  });

  it('detects a change that no fingerprint covers through the document digest', () => {
    const envelope = envelopeFixture();
    const edited = { ...envelope, provenance: { ...envelope.provenance, packageVersion: '9.9.9' } };
    const result = verifyEnvelope(edited);
    expect(result).toEqual({ ok: false, problems: ['digest'] });
  });

  it('serializes to the same bytes through JSON, so the attachment is the document', () => {
    const envelope = envelopeFixture();
    expect(verifyEnvelope(JSON.parse(JSON.stringify(envelope)))).toEqual({ ok: true });
  });
});
