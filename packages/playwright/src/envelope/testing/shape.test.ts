import { describe, expect, it } from 'vitest';

import { envelopeDigest } from '../build.js';
import { verifyEnvelope } from '../verify.js';
import { envelopeFixture } from './envelope.fixture.js';

describe('an envelope with a correct digest and missing sections', () => {
  it('is refused before anything reads it, for both versions', () => {
    const envelope = envelopeFixture();
    const { digest: _digest, identity, provenance: _provenance, ...rest } = envelope;
    const { attempt: _attempt, ...identityWithoutAttempt } = identity;
    const hollow = { ...rest, identity: identityWithoutAttempt };
    const result = verifyEnvelope({ ...hollow, digest: envelopeDigest(hollow) });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.problems).toEqual(
        expect.arrayContaining(['shape: identity.attempt', 'shape: provenance']),
      );
    }
    const legacy = { ...hollow, envelopeVersion: 1 };
    expect(verifyEnvelope({ ...legacy, digest: envelopeDigest(legacy) }).ok).toBe(false);
  });
});
