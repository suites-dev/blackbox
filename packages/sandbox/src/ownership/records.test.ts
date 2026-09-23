import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { composeProjectName } from '../lifecycle/helpers.js';
import { sandboxFixture } from '../lifecycle/runtime.fixture.js';
import { findInterruptedSandboxes, recordedError } from './records.js';

it('reports persisted nonterminal records as interrupted on later inspection', async () => {
  const { input } = await sandboxFixture();
  const recordPath = join(input.recordDirectory, `${input.sandboxId}.json`);
  await mkdir(input.recordDirectory, { recursive: true });
  await writeFile(
    recordPath,
    JSON.stringify({
      schemaVersion: 1,
      sandboxId: input.sandboxId,
      projectName: composeProjectName({ sandboxId: input.sandboxId }),
      composeFiles: input.composeFiles,
      state: 'running',
      revision: 2,
      admittedAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:01.000Z',
    }),
  );
  const interrupted = await findInterruptedSandboxes({ recordDirectory: input.recordDirectory });
  expect(interrupted).toHaveLength(1);
  expect(interrupted[0]).toMatchObject({ status: 'interrupted', record: { state: 'running' } });
});

it('returns no interruption for a missing record directory', async () => {
  const { input } = await sandboxFixture();
  await expect(
    findInterruptedSandboxes({ recordDirectory: input.recordDirectory }),
  ).resolves.toEqual([]);
});

it('records non-Error failures without losing their value', () => {
  expect(recordedError('daemon refused')).toEqual({ name: 'Error', message: 'daemon refused' });
});
