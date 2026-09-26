import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';

import { installInstrumentation } from './install.js';
import type { RuntimeInstrumentationProvider } from './model.js';

const provider = (prepare: RuntimeInstrumentationProvider['prepare']) => ({
  kind: 'runtime-instrumentation-provider' as const,
  runtime: 'node',
  displayName: 'Node.js',
  files: [
    {
      kind: 'runtime-instrumentation-file' as const,
      name: 'instrumentation.js',
      content: 'export {};\n',
    },
  ],
  activation: [],
  prepare,
});

it('rejects a symlinked instrumentation directory before preparing dependencies', async () => {
  const project = await mkdtemp(join(tmpdir(), 'instrumentation-symlink-project-'));
  const outside = await mkdtemp(join(tmpdir(), 'instrumentation-symlink-outside-'));
  const prepare = vi.fn<RuntimeInstrumentationProvider['prepare']>();
  try {
    await mkdir(join(project, '.blackbox'));
    await symlink(outside, join(project, '.blackbox', 'instrumentation'));
    const result = await installInstrumentation({
      projectDirectory: project,
      runtime: 'node',
      providers: [provider(prepare)],
    });
    expect(result).toMatchObject({ kind: 'instrumentation-install-operational-error' });
    if (result.kind !== 'instrumentation-install-operational-error') {
      throw new Error('expected an operational installation error');
    }
    expect(result.message).toMatch(/unsafe instrumentation directory/u);
    expect(prepare).not.toHaveBeenCalled();
  } finally {
    await Promise.all([
      rm(project, { recursive: true, force: true }),
      rm(outside, { recursive: true, force: true }),
    ]);
  }
});

it('rejects a symlinked managed instrumentation file', async () => {
  const project = await mkdtemp(join(tmpdir(), 'instrumentation-file-symlink-project-'));
  const outsideDirectory = await mkdtemp(join(tmpdir(), 'instrumentation-file-symlink-outside-'));
  const outside = join(outsideDirectory, 'owned.js');
  const prepare = vi.fn<RuntimeInstrumentationProvider['prepare']>();
  try {
    const directory = join(project, '.blackbox', 'instrumentation');
    await mkdir(directory, { recursive: true });
    await writeFile(outside, 'owned();\n');
    await symlink(outside, join(directory, 'instrumentation.js'));
    const result = await installInstrumentation({
      projectDirectory: project,
      runtime: 'node',
      providers: [provider(prepare)],
    });
    expect(result).toMatchObject({ kind: 'instrumentation-install-operational-error' });
    if (result.kind !== 'instrumentation-install-operational-error') {
      throw new Error('expected an operational installation error');
    }
    expect(result.message).toMatch(/symlinked instrumentation path/u);
    expect(prepare).not.toHaveBeenCalled();
  } finally {
    await Promise.all([
      rm(project, { recursive: true, force: true }),
      rm(outsideDirectory, { recursive: true, force: true }),
    ]);
  }
});
