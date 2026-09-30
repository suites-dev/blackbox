import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, expect, it } from 'vitest';

import { runHost } from '../commands.js';

const directories: string[] = [];

afterEach(async () => {
  for (const directory of directories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

async function scriptWithoutExecutePermission(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'blackbox-not-executable-'));
  directories.push(directory);
  const path = join(directory, 'not-executable');
  await writeFile(path, '#!/bin/sh\necho hi\n');
  await chmod(path, 0o644);
  return path;
}

it('reports a real host file without execute permission as not-executable, never as a crash', async () => {
  const path = await scriptWithoutExecutePermission();
  await expect(runHost({ argv: [path, 'arg'], cwd: tmpdir(), environment: {} })).resolves.toEqual({
    kind: 'not-executable',
    argv: [path, 'arg'],
    location: { kind: 'host' },
    remediation: `${path} is not executable; check its permissions or run it through its interpreter`,
  });
});

it('keeps a missing host executable as executable-not-found', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'blackbox-not-executable-'));
  directories.push(directory);
  await expect(
    runHost({ argv: [join(directory, 'missing')], cwd: tmpdir(), environment: {} }),
  ).resolves.toMatchObject({ kind: 'executable-not-found', location: { kind: 'host' } });
});

it('still rejects any other spawn error as a raw failure', async () => {
  // An argument larger than the OS limit makes spawn itself fail with E2BIG.
  const huge = 'x'.repeat(8 * 1024 * 1024);
  await expect(
    runHost({ argv: [process.execPath, huge], cwd: tmpdir(), environment: {} }),
  ).rejects.toMatchObject({ code: 'E2BIG' });
});
