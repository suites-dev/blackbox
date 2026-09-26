import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { acquireStorageLeaseWithRuntime } from '../../lease.js';
import { lockDirectoryPath } from '../../paths.js';
import { candidatePath } from '../candidate.js';
import { releaseOwnedLock } from '../lifecycle/release.js';
import {
  testLeaseInput,
  testOwner,
  testOwnerInNamespace,
  testRecord,
  testRuntime,
  expireTestCandidate,
  writeTestCandidate,
} from './testing.js';

const roots: string[] = [];

async function root(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'blackbox-collector-lease-'));
  roots.push(path);
  return path;
}

afterEach(async () => Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true }))));

it('rejects a live concurrent process owner', async () => {
  const lease = testLeaseInput(await root());
  const owner = testOwner({ pid: 91, startTimeTicks: '100' });
  const record = testRecord({ owner, token: 'live-owner' });
  const path = await writeTestCandidate({ lease, record, state: 'owned' });
  const runtime = testRuntime({
    currentOwner: testOwner({ pid: 92, startTimeTicks: '200' }),
    inspections: [{ kind: 'process-instance-observed', owner }],
    token: 'contender',
  });
  await expect(acquireStorageLeaseWithRuntime({ lease, runtime })).rejects.toThrow('already owns');
  expect(JSON.parse(await readFile(path, 'utf8'))).toEqual(record);
});

it('recovers a lock owned by a dead PID', async () => {
  const lease = testLeaseInput(await root());
  const owner = testOwner({ pid: 91, startTimeTicks: '100' });
  const expiredPath = await writeTestCandidate({
    lease,
    record: testRecord({ owner, token: 'dead-owner' }),
    state: 'owned',
  });
  await expireTestCandidate(expiredPath);
  const runtime = testRuntime({
    currentOwner: testOwner({ pid: 92, startTimeTicks: '200' }),
    inspections: [{ kind: 'process-missing', pid: owner.pid }],
    token: 'replacement',
  });
  const acquired = await acquireStorageLeaseWithRuntime({ lease, runtime });
  const path = candidatePath({
    directory: lockDirectoryPath(lease),
    token: 'replacement',
    state: 'owned',
  });
  expect(await readFile(path, 'utf8')).toContain('replacement');
  await acquired.release();
});

it('immediately recovers reused PID 1 in the same PID namespace', async () => {
  const lease = testLeaseInput(await root());
  const previous = testOwner({ pid: 1, startTimeTicks: '100' });
  const current = testOwner({ pid: 1, startTimeTicks: '200' });
  await writeTestCandidate({
    lease,
    record: testRecord({ owner: previous, token: 'previous' }),
    state: 'owned',
  });
  const runtime = testRuntime({
    currentOwner: current,
    inspections: [],
    token: 'replacement',
  });
  const acquired = await acquireStorageLeaseWithRuntime({ lease, runtime });
  const path = candidatePath({
    directory: lockDirectoryPath(lease),
    token: 'replacement',
    state: 'owned',
  });
  expect(await readFile(path, 'utf8')).toContain('replacement');
  await acquired.release();
});

it('blocks fresh PID 1 in another namespace and recovers it after heartbeat expiry', async () => {
  const lease = testLeaseInput(await root());
  const previous = testOwnerInNamespace({
    pid: 1,
    startTimeTicks: '100',
    pidNamespace: 'pid:[container-a]',
  });
  const current = testOwnerInNamespace({
    pid: 1,
    startTimeTicks: '200',
    pidNamespace: 'pid:[container-b]',
  });
  const previousPath = await writeTestCandidate({
    lease,
    record: testRecord({ owner: previous, token: 'previous-container' }),
    state: 'owned',
  });
  const runtime = testRuntime({ currentOwner: current, inspections: [], token: 'replacement' });
  await expect(acquireStorageLeaseWithRuntime({ lease, runtime })).rejects.toThrow('already owns');
  await expireTestCandidate(previousPath);
  const replacement = await acquireStorageLeaseWithRuntime({ lease, runtime });
  await replacement.release();
});

it('fences the prior owner after an expired heartbeat is replaced', async () => {
  const lease = testLeaseInput(await root());
  const previousOwner = testOwnerInNamespace({
    pid: 1,
    startTimeTicks: '100',
    pidNamespace: 'pid:[container-a]',
  });
  const previous = await acquireStorageLeaseWithRuntime({
    lease,
    runtime: testRuntime({ currentOwner: previousOwner, inspections: [], token: 'previous' }),
  });
  const previousPath = candidatePath({
    directory: lockDirectoryPath(lease),
    token: 'previous',
    state: 'owned',
  });
  await expireTestCandidate(previousPath);
  const replacementOwner = testOwnerInNamespace({
    pid: 1,
    startTimeTicks: '200',
    pidNamespace: 'pid:[container-b]',
  });
  const replacement = await acquireStorageLeaseWithRuntime({
    lease,
    runtime: testRuntime({
      currentOwner: replacementOwner,
      inspections: [],
      token: 'replacement',
    }),
  });
  await expect(previous.assertOwned()).rejects.toThrow('ownership was lost');
  await previous.release();
  await replacement.release();
});

it('rejects two collectors in the same live Node process', async () => {
  const lease = testLeaseInput(await root());
  const owner = testOwner({ pid: 42, startTimeTicks: '500' });
  const first = await acquireStorageLeaseWithRuntime({
    lease,
    runtime: testRuntime({
      currentOwner: owner,
      inspections: [],
      token: 'first',
    }),
  });
  const secondRuntime = testRuntime({
    currentOwner: owner,
    inspections: [],
    token: 'second',
  });
  await expect(acquireStorageLeaseWithRuntime({ lease, runtime: secondRuntime })).rejects.toThrow(
    'already owns',
  );
  await first.release();
});

it('allows only the current record token to release the lock', async () => {
  const lease = testLeaseInput(await root());
  const owner = testOwner({ pid: 42, startTimeTicks: '500' });
  const acquired = await acquireStorageLeaseWithRuntime({
    lease,
    runtime: testRuntime({
      currentOwner: owner,
      inspections: [],
      token: 'owner-token',
    }),
  });
  const path = candidatePath({
    directory: lockDirectoryPath(lease),
    token: 'owner-token',
    state: 'owned',
  });
  await releaseOwnedLock({ path, token: 'foreign-token' });
  expect(await readFile(path, 'utf8')).toContain('owner-token');
  await acquired.release();
  await expect(readFile(path, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
});
