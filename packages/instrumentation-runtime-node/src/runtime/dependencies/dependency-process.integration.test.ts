import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { installNodeDependencies } from './dependency-installer.js';

it('returns the real spawn failure when npm cannot enter its requested directory', async () => {
  const root = await mkdtemp(join(tmpdir(), 'blackbox-install-spawn-'));
  try {
    const result = await installNodeDependencies({ directory: join(root, 'missing') });
    expect(result).toMatchObject({
      kind: 'dependency-install-failure',
      exitCode: 1,
      stderr: expect.stringMatching(/ENOENT/u),
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
