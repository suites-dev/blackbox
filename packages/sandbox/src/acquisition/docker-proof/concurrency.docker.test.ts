import { describe, it } from 'vitest';
import { createProofContext, runProof, stopProof } from './concurrency-proof.fixture.js';
import { diagnosticError } from './proof-diagnostics.fixture.js';

const dockerEnabled = process.env.BLACKBOX_SANDBOX_DOCKER_TEST === '1';

describe.skipIf(!dockerEnabled)('Docker Compose sandbox concurrency', () => {
  it('runs five isolated projects and removes every owned resource', async () => {
    const context = await createProofContext();
    let primary: unknown = null;
    try {
      await runProof(context);
    } catch (error) {
      primary = error;
    }
    const cleanup = await stopProof(context);
    if (primary !== null || cleanup.length > 0) {
      throw diagnosticError({ primary: primary ?? new Error('Cleanup failed'), cleanup });
    }
  }, 180_000);
});
