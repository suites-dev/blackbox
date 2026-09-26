import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { acquireStorageLeaseWithRuntime } from '../../lease.js';
import {
  testLeaseInput,
  testOwner,
  testRecord,
  testRuntime,
  expireTestCandidate,
  writeTestCandidate,
  writeTestLock,
} from './testing.js';

async function testRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'blackbox-collector-lock-compatibility-'));
}

it('preserves malformed or foreign locks and fails closed', async () => {
  const root = await testRoot();
  const lease = testLeaseInput(root);
  const malformed = { token: 'not-our-record', pid: '1' };
  const path = await writeTestLock({ lease, value: malformed });
  const owner = testOwner({ pid: 1, startTimeTicks: '200' });
  const runtime = testRuntime({
    currentOwner: owner,
    inspections: [],
    token: 'contender',
  });
  await expireTestCandidate(path);
  try {
    await expect(acquireStorageLeaseWithRuntime({ lease, runtime })).rejects.toThrow('already owns');
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual(malformed);
  } finally {
    await rm(root, { recursive: true });
  }
});

it('keeps a live legacy PID-only lock fail-closed', async () => {
  const root = await testRoot();
  const lease = testLeaseInput(root);
  const legacy = { pid: 1, token: 'legacy', createdAt: '2026-09-25T00:00:00.000Z' };
  const path = await writeTestLock({ lease, value: legacy });
  const owner = testOwner({ pid: 1, startTimeTicks: '200' });
  const runtime = testRuntime({
    currentOwner: owner,
    inspections: [],
    token: 'contender',
  });
  await expireTestCandidate(path);
  try {
    await expect(acquireStorageLeaseWithRuntime({ lease, runtime })).rejects.toThrow('already owns');
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual(legacy);
  } finally {
    await rm(root, { recursive: true });
  }
});

it('recovers a legacy PID-only lock only after its PID is dead', async () => {
  const root = await testRoot();
  const lease = testLeaseInput(root);
  const legacy = { pid: 91, token: 'legacy', createdAt: '2026-09-25T00:00:00.000Z' };
  await writeTestLock({ lease, value: legacy });
  const runtime = testRuntime({
    currentOwner: testOwner({ pid: 92, startTimeTicks: '200' }),
    inspections: [{ kind: 'process-missing', pid: 91 }],
    token: 'replacement',
  });
  try {
    const acquired = await acquireStorageLeaseWithRuntime({ lease, runtime });
    await acquired.release();
  } finally {
    await rm(root, { recursive: true });
  }
});

it('keeps a lock when process inspection fails for an unknown reason', async () => {
  const root = await testRoot();
  const lease = testLeaseInput(root);
  const owner = testOwner({ pid: 91, startTimeTicks: '100' });
  const path = await writeTestCandidate({
    lease,
    record: testRecord({ owner, token: 'uninspectable' }),
    state: 'owned',
  });
  const runtime = testRuntime({
    currentOwner: testOwner({ pid: 92, startTimeTicks: '200' }),
    inspections: [{ kind: 'process-inspection-unavailable', pid: owner.pid }],
    token: 'contender',
  });
  await expireTestCandidate(path);
  try {
    await expect(acquireStorageLeaseWithRuntime({ lease, runtime })).rejects.toThrow('already owns');
    expect(await readFile(path, 'utf8')).toContain('uninspectable');
  } finally {
    await rm(root, { recursive: true });
  }
});

it('keeps a live PID-only lock when process birth cannot be observed', async () => {
  const root = await testRoot();
  const lease = testLeaseInput(root);
  const record = {
    kind: 'collector-storage-lock-v2',
    owner: { kind: 'pid-only-process', pid: 91 },
    token: 'pid-only',
    createdAt: '2026-09-25T00:00:00.000Z',
  } as const;
  const path = await writeTestCandidate({ lease, record, state: 'owned' });
  const runtime = testRuntime({
    currentOwner: { kind: 'pid-only-process', pid: 92 },
    inspections: [{ kind: 'process-alive-unidentified', pid: 91 }],
    token: 'contender',
  });
  await expireTestCandidate(path);
  try {
    await expect(acquireStorageLeaseWithRuntime({ lease, runtime })).rejects.toThrow('already owns');
    expect(await readFile(path, 'utf8')).toContain('pid-only');
  } finally {
    await rm(root, { recursive: true });
  }
});
