import { chmod, mkdtemp, readdir, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { digestBytes } from '../envelope/canonical.js';
import { defined } from './history.fixture.js';
import { ConflictError, ObjectStore } from './store.js';

const roots: string[] = [];
async function fresh(): Promise<ObjectStore> {
  const root = await mkdtemp(join(tmpdir(), 'bb-store-'));
  roots.push(root);
  return new ObjectStore(root);
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('immutable object store', () => {
  it('stores a record once and treats an identical second write as a no-op', async () => {
    const store = await fresh();
    const id = digestBytes('record');
    expect(await store.put('blob', id, 'record')).toEqual({ created: true });
    expect(await store.put('blob', id, 'record')).toEqual({ created: false });
    expect(defined(await store.get('blob', id)).toString()).toBe('record');
    expect(await store.list('blob')).toEqual([id]);
  });

  it('never overwrites: a different record under an existing identity is a conflict', async () => {
    const store = await fresh();
    const id = digestBytes('record');
    await store.put('blob', id, 'record');
    await expect(store.put('blob', id, 'tampered')).rejects.toBeInstanceOf(ConflictError);
    expect(defined(await store.get('blob', id)).toString()).toBe('record');
  });

  it('is safe under concurrent writers of the same and of different records', async () => {
    const store = await fresh();
    const same = digestBytes('shared');
    const results = await Promise.all(
      Array.from({ length: 40 }, () => store.put('blob', same, 'shared')),
    );
    expect(results.filter(({ created }) => created)).toHaveLength(1);
    const many = await Promise.all(
      Array.from({ length: 40 }, (_, index) =>
        store.put('blob', digestBytes(`r${String(index)}`), `r${String(index)}`),
      ),
    );
    expect(many.every(({ created }) => created)).toBe(true);
    expect(await store.list('blob')).toHaveLength(41);
    expect(await store.interrupted()).toEqual([]);
  });

  it('keeps an interrupted write invisible and removes it only when it is old enough', async () => {
    const store = await fresh();
    const id = digestBytes('x');
    await store.put('blob', id, 'x');
    const partial = join(store.root, 'tmp', 'blob-crashed.partial');
    await writeFile(partial, 'half a rec');
    expect(await store.interrupted()).toEqual(['blob-crashed.partial']);
    expect(await store.list('blob')).toEqual([id]);
    expect(await store.clearInterrupted(60_000)).toEqual([]);
    const old = new Date(Date.now() - 3_600_000);
    await utimes(partial, old, old);
    expect(await store.clearInterrupted(60_000)).toEqual(['blob-crashed.partial']);
    expect(await store.list('blob')).toEqual([id]);
  });

  it('writes read-only files and rejects anything that is not a content identity', async () => {
    const store = await fresh();
    const id = digestBytes('ro');
    await store.put('blob', id, 'ro');
    await chmod(join(store.root, 'objects'), 0o755);
    const shard = (await readdir(join(store.root, 'objects', 'blob')))[0];
    const [name] = await readdir(join(store.root, 'objects', 'blob', shard));
    await expect(
      writeFile(join(store.root, 'objects', 'blob', shard, name), 'overwrite'),
    ).rejects.toThrow();
    expect(() =>
      store.path('blob', digestBytes('x').slice(0, 20) as ReturnType<typeof digestBytes>),
    ).toThrow(TypeError);
  });
});
