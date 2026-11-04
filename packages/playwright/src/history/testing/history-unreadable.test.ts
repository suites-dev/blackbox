import { execFileSync } from 'node:child_process';
import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
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

  it('are reported per object when the file cannot be opened, without aborting the rest of the index', async () => {
    const root = await emptyRoot();
    const store = new ObjectStore(root);
    const other = digestBytes('another blob');
    await store.put('blob', other, 'another blob');
    const path = store.path('blob', id);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content);
    await chmod(path, 0o000);
    const history = await BehaviorHistory.open(root);
    const report = await history.verifyStore();
    await chmod(path, 0o644);
    if (typeof process.getuid === 'function' && process.getuid() === 0) {
      return;
    }
    expect(report.corrupt.map(({ id: corrupt }) => corrupt)).toEqual([id]);
  });
});

describe('the store and its cache when parts of them cannot be read', () => {
  it('rebuilds the index instead of waiting on a cache that is a pipe', async () => {
    const root = await emptyRoot();
    const store = new ObjectStore(root);
    await store.put('blob', id, content);
    await mkdir(join(root, 'index'), { recursive: true });
    execFileSync('mkfifo', [join(root, 'index', 'index.json')]);
    const history = await BehaviorHistory.open(root);
    expect((await history.index()).blobs).toEqual([id]);
  });

  it('are not hidden by a shard directory that cannot be listed', async () => {
    const root = await emptyRoot();
    const store = new ObjectStore(root);
    await store.put('blob', id, content);
    const shard = dirname(store.path('blob', id));
    await chmod(shard, 0o000);
    const listed = await store.list('blob').then(
      (found) => found,
      (error: unknown) => error,
    );
    await chmod(shard, 0o755);
    if (typeof process.getuid === 'function' && process.getuid() === 0) {
      return;
    }
    expect(listed).toBeInstanceOf(Error);
    expect(await store.list('blob')).toEqual([id]);
    expect(await store.list('receipt')).toEqual([]);
  });
});
