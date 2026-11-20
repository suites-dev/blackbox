import { expect } from '../../../index.js';
import { record } from '../evidence.fixture.js';
import { test, fixtureFor, useProject } from './runtime.fixture.js';
import { observeReads } from './reads.fixture.js';

test.describe('native lazy cancellation', () => {
  useProject();
  test('native timeout cancels lazy reads without a terminal assertion artifact', async ({ stimulus, sandbox }) => {
    test.setTimeout(1_000);
    const fixture = fixtureFor(sandbox.executionId);
    const outcome = await stimulus('When telemetry never arrives before cancellation', ({ request, headers }) => request.post(`${fixture.url}/payments`, { headers }));
    if (outcome.evidence.effects === undefined) { throw new Error('Missing stimulus effects'); }
    const selected = outcome.evidence.effects.http({ route: '/payments' });
    const observed = observeReads(selected);
    const checking = outcome.verify('Then an unfinished lazy claim is interrupted', async () => {
      await expect.configure({ timeout: 10_000 })(selected).toHaveEmitted();
    });
    void checking.catch(() => undefined);
    const first = await Promise.race([observed.first, checking.then(() => { throw new Error('Verification completed without a collector read'); })]);
    record('lazy-cancellation-started', { captureId: first.identity.captureId, emissions: first.http().emissions.length, executionId: sandbox.executionId });
    try { await checking; } finally { observed.restore(); }
  });
});
