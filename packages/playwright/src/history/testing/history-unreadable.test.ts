import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { digestBytes } from '../../envelope/index.js';
import { BehaviorHistory } from '../history.js';
import { ObjectStore, UnreadableObjectError } from '../storage/store.js';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function emptyRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'bb-unreadable-'));
  roots.push(root);
  return root;
}

const content = 'x'.repeat(32);
const id = digestBytes(content);

describe('object files that are not ordinary, bounded files', () => {
  it('are never read when they exceed the limit, whether read back or compared before a write', async () => {
    const root = await emptyRoot();
    const store = new ObjectStore(root, 4);
    const path = store.path('blob', id);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content);
    await expect(store.get('blob', id)).rejects.toBeInstanceOf(UnreadableObjectError);
    await expect(new ObjectStore(root, 64).put('blob', id, content)).resolves.toEqual({
      created: false,
    });
    await expect(store.put('blob', id, 'abc')).rejects.toBeInstanceOf(UnreadableObjectError);
  });

  it('are never followed when they are symbolic links', async () => {
    const root = await emptyRoot();
    const store = new ObjectStore(root);
    const path = store.path('blob', id);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(join(root, 'elsewhere'), content);
    await symlink(join(root, 'elsewhere'), path);
    await expect(store.get('blob', id)).rejects.toBeInstanceOf(UnreadableObjectError);
    await expect(store.put('blob', id, content)).rejects.toBeInstanceOf(UnreadableObjectError);
  });

  it('are reported as corrupt, not waited on, when they are pipes', async () => {
    const root = await emptyRoot();
    const store = new ObjectStore(root);
    const path = store.path('blob', id);
    await mkdir(dirname(path), { recursive: true });
    execFileSync('mkfifo', [path]);
    await expect(store.get('blob', id)).rejects.toThrow('not a regular file');
    const history = await BehaviorHistory.open(root);
    const report = await history.verifyStore();
    expect(report.corrupt).toEqual([
      expect.objectContaining({
        kind: 'blob',
        id,
        reason: expect.stringContaining('regular file'),
      }),
    ]);
  });
});
