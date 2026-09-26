import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  admitCapsuleRecord,
  capsuleActivityPath,
  capsuleRecordPath,
  capsuleSessionDirectory,
} from '../../records.js';
import { retainedRecord, completedHostActivity } from '../../persistence/testing/record.fixture.js';
import { reportCapsule } from '../../session/operations.js';

const roots: string[] = [];

async function fixture(sessionId: string) {
  const projectDirectory = await mkdtemp(join(tmpdir(), 'capsule-report-failure-'));
  roots.push(projectDirectory);
  const selector = { projectDirectory, sessionId };
  const record = {
    ...retainedRecord(projectDirectory),
    sessionId,
    artifactRoot: capsuleSessionDirectory(selector),
  };
  await writeFile(join(projectDirectory, 'blackbox.config.yaml'), 'schemaVersion: 1\n');
  await admitCapsuleRecord({ projectDirectory, record });
  await writeFile(capsuleActivityPath(selector), JSON.stringify([completedHostActivity()]));
  return selector;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('Capsule report artifact failures', () => {
  it('returns explicit missing and corrupt artifact failures', async () => {
    const selected = await fixture('calm-river-maya');
    await writeFile(capsuleActivityPath(selected), '{not-json');
    await expect(reportCapsule(selected)).resolves.toMatchObject({
      kind: 'capsule-report-artifact-failed',
      artifact: 'activities',
      sessionId: selected.sessionId,
    });
    await expect(
      reportCapsule({ projectDirectory: selected.projectDirectory, sessionId: 'calm-river-noah' }),
    ).resolves.toMatchObject({ kind: 'capsule-not-found' });
  });

  it('distinguishes corrupt progress from a missing optional journal', async () => {
    const selected = await fixture('flying-summit-grace');
    const progressPath = join(capsuleSessionDirectory(selected), 'progress.json');
    await mkdir(capsuleSessionDirectory(selected), { recursive: true });
    await writeFile(progressPath, 'not-json');
    await expect(reportCapsule(selected)).resolves.toMatchObject({
      kind: 'capsule-report-artifact-failed',
      artifact: 'progress',
    });
  });

  it('identifies a corrupt exact session record', async () => {
    const selected = await fixture('rapid-harbor-alex');
    await writeFile(capsuleRecordPath(selected), 'not-json');
    await expect(reportCapsule(selected)).resolves.toMatchObject({
      kind: 'capsule-report-artifact-failed',
      artifact: 'session',
    });
  });
});
