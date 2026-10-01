import { mkdtemp, readdir, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, it } from 'vitest';

import { admitCapsuleRecord } from './records.js';
import { runningRecord } from './session/recovery/recovery.fixture.js';

it('audit #13: state directory creation must reject symlink traversal', async () => {
  const projectDirectory = await mkdtemp(join(tmpdir(), 'capsule-audit-13-project-'));
  const outsideDirectory = await mkdtemp(join(tmpdir(), 'capsule-audit-13-outside-'));
  try {
    await symlink(outsideDirectory, join(projectDirectory, '.blackbox'));
    await expect(admitCapsuleRecord({
      projectDirectory,
      record: runningRecord(projectDirectory),
    })).rejects.toThrow();
    await expect(readdir(outsideDirectory)).resolves.toStrictEqual([]);
  } finally {
    await rm(projectDirectory, { recursive: true, force: true });
    await rm(outsideDirectory, { recursive: true, force: true });
  }
});
