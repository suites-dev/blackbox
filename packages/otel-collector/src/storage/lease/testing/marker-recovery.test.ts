import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { acquireStorageLeaseWithRuntime } from '../../lease.js';
import { lockPath, sessionDirectory } from '../../paths.js';
import { recoveryGuardPath } from '../marker-recovery.js';
import { testLeaseInput, testOwner, testRecord, testRuntime, writeTestLock } from './testing.js';

const staleOwner = testOwner({ pid: 91, startTimeTicks: '100' });
const currentOwner = testOwner({ pid: 92, startTimeTicks: '200' });
const crashedClaimer = testOwner({ pid: 93, startTimeTicks: '300' });
const roots: string[] = [];

afterEach(async () => {
  for (const root of roots.splice(0)) {
    await rm(root, { recursive: true });
  }
});

/** A session whose marker belongs to a process that is gone. */
async function staleMarkerSession() {
  const root = await mkdtemp(join(tmpdir(), 'blackbox-collector-marker-guard-'));
  roots.push(root);
  const lease = testLeaseInput(root);
  await writeTestLock({ lease, value: testRecord({ owner: staleOwner, token: 'stale' }) });
  const guard = recoveryGuardPath({ path: lockPath(lease), token: 'stale' });
  const runtime = testRuntime({
    currentOwner,
    inspections: [
      { kind: 'process-missing', pid: staleOwner.pid },
      { kind: 'process-missing', pid: crashedClaimer.pid },
    ],
    token: 'fresh',
  });
  return { lease, guard, runtime };
}

async function markerToken(path: string): Promise<string> {
  return (JSON.parse(await readFile(path, 'utf8')) as { token: string }).token;
}

it('recovers a stale marker through its guard and leaves no guard behind', async () => {
  const { lease, runtime } = await staleMarkerSession();
  const acquired = await acquireStorageLeaseWithRuntime({ lease, runtime });
  try {
    expect(await markerToken(lockPath(lease))).toBe('fresh');
    expect(
      (await readdir(sessionDirectory(lease))).filter((name) => name.includes('.recover-')),
    ).toEqual([]);
  } finally {
    await acquired.release();
  }
});

it('refuses while another live claimer holds the guard, and leaves the stale marker alone', async () => {
  const { lease, guard, runtime } = await staleMarkerSession();
  await writeFile(
    guard,
    `${JSON.stringify(testRecord({ owner: currentOwner, token: 'rival' }))}\n`,
  );
  await expect(acquireStorageLeaseWithRuntime({ lease, runtime })).rejects.toThrow(
    'A collector already owns session test-session execution test-execution.',
  );
  expect(await markerToken(lockPath(lease))).toBe('stale');
  expect(await markerToken(guard)).toBe('rival');
});

it('recovers a guard left by a claimer that crashed mid-recovery', async () => {
  const { lease, guard, runtime } = await staleMarkerSession();
  await writeFile(
    guard,
    `${JSON.stringify(testRecord({ owner: crashedClaimer, token: 'crashed' }))}\n`,
  );
  const acquired = await acquireStorageLeaseWithRuntime({ lease, runtime });
  try {
    expect(await markerToken(lockPath(lease))).toBe('fresh');
    await expect(readFile(guard, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  } finally {
    await acquired.release();
  }
});

it('fails closed on an unreadable guard', async () => {
  const { lease, guard, runtime } = await staleMarkerSession();
  await writeFile(guard, 'not a lease record');
  await expect(acquireStorageLeaseWithRuntime({ lease, runtime })).rejects.toThrow(
    'A collector already owns session test-session execution test-execution.',
  );
  expect(await markerToken(lockPath(lease))).toBe('stale');
  expect(await readFile(guard, 'utf8')).toBe('not a lease record');
});
