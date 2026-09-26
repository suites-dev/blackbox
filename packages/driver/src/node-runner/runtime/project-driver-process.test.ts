import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, it } from 'vitest';

import { runProjectDriverProcess } from './project-driver-process.js';

async function projectDirectory(): Promise<string> {
  return await mkdtemp(join(tmpdir(), 'blackbox-driver-process-'));
}

it('retains a nonzero runner exit with its stderr diagnostics', async () => {
  await expect(
    runProjectDriverProcess({
      source: `process.stderr.write('project driver import failed'); process.exitCode = 7;`,
      projectDirectory: await projectDirectory(),
      requestJson: '{}',
    }),
  ).rejects.toThrow('code 7, signal null: project driver import failed');
});

it('terminates a driver that exceeds the bounded protocol output', async () => {
  await expect(
    runProjectDriverProcess({
      source: `process.stdout.write('x'.repeat(1024 * 1024 + 1));`,
      projectDirectory: await projectDirectory(),
      requestJson: '{}',
    }),
  ).rejects.toThrow('Driver protocol output exceeded 1 MiB');
});

it('includes stderr in the bounded protocol output', async () => {
  await expect(
    runProjectDriverProcess({
      source: `process.stderr.write('x'.repeat(1024 * 1024 + 1));`,
      projectDirectory: await projectDirectory(),
      requestJson: '{}',
    }),
  ).rejects.toThrow('Driver protocol output exceeded 1 MiB');
});
