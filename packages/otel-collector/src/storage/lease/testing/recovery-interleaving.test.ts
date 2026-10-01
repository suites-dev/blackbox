import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { acquireStorageLeaseWithRuntime } from '../../lease.js';
import { lockDirectoryPath, lockPath } from '../../paths.js';
import { readCandidates } from '../candidate-set.js';
import type { CollectorStorageLease, LeaseRuntime, ProcessInspection } from '../types.js';
import {
  testLeaseInput,
  testOwner,
  testRecord,
  testRuntime,
  writeTestCandidate,
  writeTestLock,
} from './testing.js';

const staleOwner = testOwner({ pid: 91, startTimeTicks: '100' });
const currentOwner = testOwner({ pid: 92, startTimeTicks: '200' });

function deferred(): { readonly promise: Promise<void>; readonly resolve: () => void } {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

/**
 * A claimer whose process inspections are gated: inspecting the stale owner
 * waits for `before`, and inspecting its own process (the first thing it does
 * after publishing its marker and candidate) resolves `published`.
 */
function gatedRuntime(input: {
  readonly token: string;
  readonly arrived: () => void;
  readonly before: Promise<void>;
  readonly published: () => void;
}): LeaseRuntime {
  const base = testRuntime({ currentOwner, inspections: [], token: input.token });
  return {
    ...base,
    inspectProcess: async ({ pid }): Promise<ProcessInspection> => {
      if (pid === staleOwner.pid) {
        input.arrived();
        await input.before;
        return { kind: 'process-missing', pid };
      }
      input.published();
      return base.inspectProcess({ pid });
    },
  };
}

it('lets exactly one claimer replace a stale marker even when both judged it stale first', async () => {
  const root = await mkdtemp(join(tmpdir(), 'blackbox-collector-marker-recovery-'));
  const lease = testLeaseInput(root);
  await writeTestLock({ lease, value: testRecord({ owner: staleOwner, token: 'stale' }) });
  // Both claimers read the stale marker and judge it stale; only then may
  // alpha continue, and bravo continues only once alpha has published its own
  // marker. A check-then-remove recovery lets bravo delete alpha's marker here.
  let arrivals = 0;
  const bothArrived = deferred();
  const alphaPublished = deferred();
  const arrived = (): void => {
    arrivals += 1;
    if (arrivals === 2) {
      bothArrived.resolve();
    }
  };
  const alpha = gatedRuntime({
    token: 'alpha',
    arrived,
    before: bothArrived.promise,
    published: alphaPublished.resolve,
  });
  const bravo = gatedRuntime({
    token: 'bravo',
    arrived,
    before: Promise.all([bothArrived.promise, alphaPublished.promise]).then(() => undefined),
    published: () => undefined,
  });
  const winners: CollectorStorageLease[] = [];
  try {
    const outcomes = await Promise.allSettled([
      acquireStorageLeaseWithRuntime({ lease, runtime: alpha }),
      acquireStorageLeaseWithRuntime({ lease, runtime: bravo }),
    ]);
    for (const outcome of outcomes) {
      if (outcome.status === 'fulfilled') {
        winners.push(outcome.value);
      }
    }
    expect(outcomes.map((outcome) => outcome.status)).toEqual(['fulfilled', 'rejected']);
    // The winner still holds the marker it published; nobody removed it.
    const marker = JSON.parse(await readFile(lockPath(lease), 'utf8')) as { token: string };
    expect(marker.token).toBe('alpha');
  } finally {
    for (const winner of winners) {
      await winner.release();
    }
    await rm(root, { recursive: true });
  }
});

it('reads a claiming candidate that was promoted after the directory listing as owned', async () => {
  const root = await mkdtemp(join(tmpdir(), 'blackbox-collector-candidate-promotion-'));
  const lease = testLeaseInput(root);
  // The listing was taken while alpha was still claiming; alpha has since
  // renamed its candidate to owned. A rival must see an owner, never "stale".
  const listing = ['616c706861.claiming'];
  await writeTestCandidate({
    lease,
    record: testRecord({ owner: currentOwner, token: 'alpha' }),
    state: 'owned',
  });
  try {
    const read = await readCandidates({
      directory: lockDirectoryPath(lease),
      names: listing,
      runtime: testRuntime({ currentOwner, inspections: [], token: 'bravo' }),
    });
    expect(read.kind).toBe('candidate-set');
    expect(
      read.kind === 'candidate-set' ? read.candidates.map((candidate) => candidate.kind) : [],
    ).toEqual(['owned-candidate']);
  } finally {
    await rm(root, { recursive: true });
  }
});

it('still drops a claiming candidate that vanished without becoming owned', async () => {
  const root = await mkdtemp(join(tmpdir(), 'blackbox-collector-candidate-withdrawn-'));
  const lease = testLeaseInput(root);
  await writeTestCandidate({
    lease,
    record: testRecord({ owner: currentOwner, token: 'other' }),
    state: 'claiming',
  });
  try {
    const read = await readCandidates({
      directory: lockDirectoryPath(lease),
      names: ['616c706861.claiming'],
      runtime: testRuntime({ currentOwner, inspections: [], token: 'bravo' }),
    });
    expect(read).toEqual({ kind: 'candidate-set', candidates: [] });
  } finally {
    await rm(root, { recursive: true });
  }
});
