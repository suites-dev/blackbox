import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { replaceFile } from './replace-file.js';

function codeError(code: string): Error {
  return Object.assign(new Error(`${code}: rename refused`), { code });
}

function flakyRename(failures: readonly string[]) {
  const calls: string[] = [];
  return {
    calls,
    rename: (source: string, target: string) => {
      calls.push(`${source}->${target}`);
      return calls.length > failures.length
        ? Promise.resolve()
        : Promise.reject(codeError(failures[calls.length - 1]));
    },
  };
}

describe('replaceFile', () => {
  it('replaces an existing file on the real filesystem', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'bb-replace-'));
    try {
      await writeFile(join(directory, 'target.json'), 'old');
      await writeFile(join(directory, 'source.tmp'), 'new');
      await replaceFile(join(directory, 'source.tmp'), join(directory, 'target.json'));
      await expect(readFile(join(directory, 'target.json'), 'utf8')).resolves.toBe('new');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it.each(['EPERM', 'EACCES', 'EBUSY'])('retries a transient Windows %s refusal', async (code) => {
    const port = flakyRename([code, code]);
    await replaceFile('a.tmp', 'a.json', 'win32', port.rename);
    expect(port.calls).toHaveLength(3);
  });

  it('fails immediately on non-Windows platforms', async () => {
    const port = flakyRename(['EPERM']);
    await expect(
      replaceFile('a.tmp', 'a.json', 'linux', port.rename),
    ).rejects.toMatchObject({ code: 'EPERM' });
    expect(port.calls).toHaveLength(1);
  });

  it('does not retry non-transient Windows errors', async () => {
    const port = flakyRename(['ENOENT']);
    await expect(
      replaceFile('a.tmp', 'a.json', 'win32', port.rename),
    ).rejects.toMatchObject({ code: 'ENOENT' });
    expect(port.calls).toHaveLength(1);
  });

  it('gives up after a bounded number of Windows attempts', async () => {
    const port = flakyRename(Array.from({ length: 100 }, () => 'EPERM'));
    await expect(
      replaceFile('a.tmp', 'a.json', 'win32', port.rename),
    ).rejects.toMatchObject({ code: 'EPERM' });
    expect(port.calls).toHaveLength(40);
  });
});
