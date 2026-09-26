import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { acquireStorageLeaseWithRuntime } from '../../lease.js';
import type { CollectorStorageLease } from '../types.js';
import {
  testLeaseInput,
  testOwner,
  testRecord,
  testRuntime,
  expireTestCandidate,
  writeTestCandidate,
} from './testing.js';

it('admits exactly one collector when two claimers recover the same stale owner', async () => {
  const root = await mkdtemp(join(tmpdir(), 'blackbox-collector-concurrent-recovery-'));
  const lease = testLeaseInput(root);
  const staleOwner = testOwner({ pid: 91, startTimeTicks: '100' });
  const currentOwner = testOwner({ pid: 92, startTimeTicks: '200' });
  const stalePath = await writeTestCandidate({
    lease,
    record: testRecord({ owner: staleOwner, token: 'stale' }),
    state: 'owned',
  });
  await expireTestCandidate(stalePath);
  const runtime = (token: string) =>
    testRuntime({
      currentOwner,
      inspections: [{ kind: 'process-missing', pid: staleOwner.pid }],
      token,
    });
  let winner: CollectorStorageLease | null = null;
  try {
    const outcomes = await Promise.allSettled([
      acquireStorageLeaseWithRuntime({ lease, runtime: runtime('alpha') }),
      acquireStorageLeaseWithRuntime({ lease, runtime: runtime('bravo') }),
    ]);
    const successes = outcomes.filter((outcome) => outcome.status === 'fulfilled');
    const failures = outcomes.filter((outcome) => outcome.status === 'rejected');
    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);
    const success = successes.at(0);
    if (success === undefined) {
      throw new Error('Expected one collector to acquire the recovered lease.');
    }
    winner = success.value;
    expect(winner).not.toBeNull();
  } finally {
    if (winner !== null) {
      await winner.release();
    }
    await rm(root, { recursive: true });
  }
});
