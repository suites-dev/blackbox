import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';

import { sandboxFixture } from '../lifecycle/runtime.fixture.js';
import { findInterruptedSandboxes } from '../index.js';

const ownedRoots: string[] = [];
afterEach(async () => {
  await Promise.all(ownedRoots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function recordsDirectory(): Promise<string> {
  const fixture = await sandboxFixture();
  ownedRoots.push(fixture.root);
  await mkdir(fixture.input.recordDirectory);
  return fixture.input.recordDirectory;
}

it('discovers all nonterminal states but excludes terminal records and partial-write files', async () => {
  const recordDirectory = await recordsDirectory();
  const states = [
    'admitted',
    'starting',
    'running',
    'stopping',
    'completed',
    'start-failed',
    'stop-failed',
  ];
  await Promise.all(
    states.map((state, index) =>
      writeFile(
        join(recordDirectory, `${index}.json`),
        JSON.stringify({
          schemaVersion: 1,
          sandboxId: `sandbox-${index}`,
          projectName: `project-${index}`,
          composeFiles: ['compose.yaml'],
          state,
          revision: index,
          admittedAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:01.000Z',
          ...(state === 'completed' ? { stopReason: 'completed', cleanup: 'complete' } : {}),
          ...(state.endsWith('-failed')
            ? {
                primaryError: { name: 'Error', message: 'failure' },
                cleanup: { kind: 'failed', error: { name: 'Error', message: 'cleanup failed' } },
              }
            : {}),
        }),
      ),
    ),
  );
  await writeFile(join(recordDirectory, 'partial.json.1.2.tmp'), '{');
  const result = await findInterruptedSandboxes({ recordDirectory });
  expect(result.map(({ status, record }) => [status, record.sandboxId, record.state])).toEqual([
    ['interrupted', 'sandbox-0', 'admitted'],
    ['interrupted', 'sandbox-1', 'starting'],
    ['interrupted', 'sandbox-2', 'running'],
    ['interrupted', 'sandbox-3', 'stopping'],
  ]);
});

it('surfaces malformed retained JSON instead of reporting an empty recovery set', async () => {
  const recordDirectory = await recordsDirectory();
  await writeFile(join(recordDirectory, 'broken.json'), '{');
  await expect(findInterruptedSandboxes({ recordDirectory })).rejects.toBeInstanceOf(SyntaxError);
});

it('surfaces inaccessible record locations rather than treating them as missing', async () => {
  const recordDirectory = await recordsDirectory();
  const file = join(recordDirectory, 'regular-file');
  await writeFile(file, 'not a directory');
  await expect(findInterruptedSandboxes({ recordDirectory: file })).rejects.toMatchObject({
    code: 'ENOTDIR',
  });
});
