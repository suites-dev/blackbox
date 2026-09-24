import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import {
  admitCapsuleRecord,
  capsuleRecordPath,
  capsuleSessionDirectory,
  readCapsuleRecord,
} from '../records.js';
import { listCapsuleSessions } from '../registry/list.js';
import { reportCapsule } from '../session/operations.js';
import { decodeCapsuleSessionRecord } from './decoder.js';
import { retainedRecord } from './testing/record.fixture.js';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const projectDirectory = await realpath(await mkdtemp(join(tmpdir(), 'absence-contract-')));
  roots.push(projectDirectory);
  await writeFile(join(projectDirectory, 'blackbox.config.yaml'), 'schemaVersion: 1\n');
  const record = retainedRecord(projectDirectory);
  await admitCapsuleRecord({ projectDirectory, record });
  return { selector: { projectDirectory, sessionId: record.sessionId }, record };
}

const unionFields = [
  'description',
  'manager',
  'entrypoint',
  'composeProject',
  'readiness',
  'failure',
  'cleanup',
];
it.each(unionFields)(
  'rejects missing and unknown %s instead of supplying a success default',
  (field) => {
    const record = retainedRecord('/project');
    const absent = Object.fromEntries(Object.entries(record).filter(([key]) => key !== field));
    expect(() => decodeCapsuleSessionRecord({ bytes: JSON.stringify(absent) })).toThrow();
    for (const value of [null, {}, { kind: 'unknown' }]) {
      expect(() =>
        decodeCapsuleSessionRecord({ bytes: JSON.stringify({ ...record, [field]: value }) }),
      ).toThrow();
    }
  },
);

it.each([
  ['description', { kind: 'provided' }],
  ['manager', { kind: 'started' }],
  ['entrypoint', { kind: 'available' }],
  ['entrypoint', { kind: 'available', value: {} }],
  ['composeProject', { kind: 'available' }],
  ['readiness', { kind: 'available' }],
  ['failure', { kind: 'recorded' }],
  ['cleanup', { kind: 'failed' }],
])('rejects an incomplete %s payload', (field, value) => {
  expect(() =>
    decodeCapsuleSessionRecord({
      bytes: JSON.stringify({ ...retainedRecord('/project'), [field]: value }),
    }),
  ).toThrow();
});

it('preserves explicit unavailable states across real persistence and JSON transport', async () => {
  const { selector, record } = await fixture();
  expect(await readCapsuleRecord(selector)).toStrictEqual(record);
  const result = await reportCapsule(selector);
  expect(result.kind).toBe('capsule-report');
  expect(JSON.parse(JSON.stringify(result))).toStrictEqual(result);
});

it.each(['activities', 'progress'])(
  'reports deleted %s journal as missing evidence, not empty success',
  async (artifact) => {
    const { selector } = await fixture();
    await rm(join(capsuleSessionDirectory(selector), `${artifact}.json`));
    await expect(reportCapsule(selector)).resolves.toMatchObject({
      kind: 'capsule-report-artifact-failed',
      artifact,
    });
  },
);

it.each([
  { state: 'stopped', cleanup: { kind: 'not-attempted' } },
  { state: 'running' },
  { containers: [null] },
  { containers: [{}] },
])('registry and report refuse corrupted persisted state %j', async (change) => {
  const { selector, record } = await fixture();
  await writeFile(capsuleRecordPath(selector), JSON.stringify({ ...record, ...change }));
  await expect(reportCapsule(selector)).resolves.toMatchObject({
    kind: 'capsule-report-artifact-failed',
    artifact: 'session',
  });
  await expect(
    listCapsuleSessions({ projectDirectory: selector.projectDirectory }),
  ).resolves.toMatchObject({
    kind: 'capsule-session-registry',
    entries: [{ kind: 'capsule-session-corrupt', failure: { kind: 'record-corrupt' } }],
  });
});
