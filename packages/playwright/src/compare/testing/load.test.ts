import { describe, expect, it } from 'vitest';

import { envelopeDigest, experimentDigest } from '../../envelope/build.js';
import { captureDigest, configurationFingerprint } from '../../envelope/fingerprints.js';
import type { BehaviorEnvelope } from '../../envelope/index.js';
import { verifyEnvelope } from '../../envelope/verify.js';
import { compareSides } from '../compare.js';
import { checkOf } from './delta.fixture.js';
import { healthy, rawSide, sideFixture } from './compare.fixture.js';
import { loadSide } from '../side.js';

/** The version 1 document for the same attempt: no stimulus, no state, no infrastructure profile. */
function legacyOf(envelope: BehaviorEnvelope) {
  const { stimulus: _stimulus, state: _state, digest: _digest, ...rest } = envelope;
  const {
    digest: _captureDigest,
    noiseProfile: _noise,
    ...captureBody
  } = envelope.configuration.capture;
  const capture = { ...captureBody, digest: captureDigest(captureBody) };
  const configuration = { ...envelope.configuration, capture };
  const withFingerprint = {
    ...configuration,
    fingerprint: configurationFingerprint(configuration),
  };
  const { stimulus: _identityStimulus, ...identity } = envelope.identity;
  const body = {
    ...rest,
    envelopeVersion: 1,
    expectations: { ...envelope.expectations, acceptedBaselines: [] },
    identity: {
      ...identity,
      experiment: experimentDigest(
        envelope.identity.behavior.id,
        withFingerprint.fingerprint,
        'not-recorded',
      ),
    },
    configuration: withFingerprint,
  };
  return { ...body, digest: envelopeDigest(body) };
}

describe('the version 1 expectations field', () => {
  it('is not part of a version 2 envelope, and a forged value in a version 1 envelope is rejected', () => {
    const side = sideFixture({ spans: healthy });
    expect(Object.keys(side.envelope.expectations).sort()).toEqual([
      'acceptedContracts',
      'declaredInTest',
    ]);
    const legacy = legacyOf(side.envelope);
    expect(verifyEnvelope(legacy)).toEqual({ ok: true });
    const forged = {
      ...legacy,
      expectations: { ...legacy.expectations, acceptedBaselines: ['x'] },
    };
    const result = verifyEnvelope(forged);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.problems).toContain('expectations.acceptedBaselines');
    }
  });
});

describe('loading a side', () => {
  it('rejects an envelope whose content no longer matches its digest', () => {
    const side = sideFixture({ spans: healthy });
    const tampered = { ...side.envelope, source: { ...side.envelope.source, commit: 'other' } };
    const loaded = loadSide({ envelope: tampered, snapshotBody: JSON.stringify(side.snapshot) });
    expect(loaded.kind).toBe('rejected');
  });

  it('does not use a snapshot whose bytes differ from the recorded digest, and says so', () => {
    const side = sideFixture({ spans: healthy });
    const { envelope, body } = rawSide({ spans: healthy });
    const loaded = loadSide({ envelope, snapshotBody: `${body} ` });
    expect(loaded).toMatchObject({ kind: 'loaded', side: { snapshot: null } });
    const delta = compareSides(side, loaded.kind === 'loaded' ? loaded.side : side);
    expect(delta.outcome).toBe('inconclusive');
    expect(delta.unresolved.map(({ kind }) => kind)).toContain('evidence-unavailable');
  });

  it('reads a version 1 envelope as having no recorded stimulus and no infrastructure profile', () => {
    const { envelope, body } = rawSide({ spans: healthy });
    const legacy = legacyOf(envelope);
    expect(verifyEnvelope(legacy)).toEqual({ ok: true });
    const loaded = loadSide({ envelope: legacy, snapshotBody: body });
    if (loaded.kind !== 'loaded') {
      throw new Error(loaded.problems.join(','));
    }
    expect(loaded.side.envelope).toMatchObject({
      sourceVersion: 1,
      stimulus: { state: 'unavailable', fingerprint: null },
    });
    const delta = compareSides(loaded.side, loaded.side);
    expect(delta.outcome).toBe('inconclusive');
    expect(delta.unresolved.map(({ kind }) => kind)).toContain('stimulus-unestablished');
  });

  it('treats a version 1 and a version 2 capture as different measurement bases', () => {
    const side = sideFixture({ spans: healthy });
    const loaded = loadSide({
      envelope: legacyOf(side.envelope),
      snapshotBody: JSON.stringify(side.snapshot),
    });
    if (loaded.kind !== 'loaded') {
      throw new Error('legacy side must load');
    }
    const delta = compareSides(loaded.side, side);
    expect(checkOf(delta, 'measurement-basis').detail).toContain('infrastructure profile');
    expect(delta.outcome).toBe('inconclusive');
  });
});
