import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { git, remove, repository } from './capture.fixture.js';
import { captureSource } from './revision.js';

const roots: string[] = [];
const repo = async () => {
  const root = await repository({ 'src/app.js': 'one\n', '.gitignore': 'out/\n' });
  roots.push(root);
  return root;
};
const source = (root: string, ignore: string[] = []) => captureSource({ directory: root, ignore });

afterEach(async () => {
  await Promise.all(roots.splice(0).map(remove));
});

describe('source capture', () => {
  it('captures a clean commit and is stable for the same commit', async () => {
    const root = await repo();
    const first = await source(root);
    const second = await source(root);
    expect(first.source).toMatchObject({
      state: 'captured',
      workingTree: { state: 'clean' },
      commit: git(root, 'rev-parse', 'HEAD'),
    });
    expect(second.source.fingerprint).toBe(first.source.fingerprint);
    expect(first.source.repoId).toBe(`git:${git(root, 'rev-list', '--max-parents=0', 'HEAD')}`);
  });

  it('does not report a modified working tree as its last commit', async () => {
    const root = await repo();
    const clean = await source(root);
    await writeFile(join(root, 'src/app.js'), 'two\n');
    const edited = await source(root);
    expect(edited.source.commit).toBe(clean.source.commit);
    expect(edited.source.workingTree.state).toBe('dirty');
    expect(edited.source.fingerprint).not.toBe(clean.source.fingerprint);
    expect(edited.changedPaths).toEqual(['src/app.js']);
    await writeFile(join(root, 'src/app.js'), 'three\n');
    expect((await source(root)).source.fingerprint).not.toBe(edited.source.fingerprint);
    await writeFile(join(root, 'src/app.js'), 'two\n');
    expect((await source(root)).source.fingerprint).toBe(edited.source.fingerprint);
  });

  it('sees an untracked file and its content, project inputs under .blackbox, but not ignored output or Blackbox runtime directories', async () => {
    const root = await repo();
    const clean = await source(root);
    await mkdir(join(root, 'out'));
    await writeFile(join(root, 'out/result.json'), '{}');
    await mkdir(join(root, '.blackbox/tmp'), { recursive: true });
    await writeFile(join(root, '.blackbox/tmp/run'), 'x');
    expect((await source(root)).source.fingerprint).toBe(clean.source.fingerprint);
    await mkdir(join(root, '.blackbox/catalog'), { recursive: true });
    await writeFile(join(root, '.blackbox/catalog/system.yml'), 'services: {}');
    expect((await source(root)).source.workingTree.state).toBe('dirty');
    await rm(join(root, '.blackbox/catalog'), { recursive: true });
    await writeFile(join(root, 'new.js'), 'a');
    const added = await source(root);
    expect(added.source.workingTree.state).toBe('dirty');
    await writeFile(join(root, 'new.js'), 'b');
    expect((await source(root)).source.fingerprint).not.toBe(added.source.fingerprint);
  });

  it('excludes the run output directory it is told about', async () => {
    const root = await repo();
    const clean = await source(root);
    await mkdir(join(root, 'test-results'));
    await writeFile(join(root, 'test-results/trace.zip'), 'z');
    expect((await source(root)).source.workingTree.state).toBe('dirty');
    expect((await source(root, [join(root, 'test-results')])).source.fingerprint).toBe(
      clean.source.fingerprint,
    );
  });

  it('reports a missing repository or history as unavailable, with a reason', async () => {
    const plain = await mkdtemp(join(tmpdir(), 'bb-plain-'));
    roots.push(plain);
    expect((await source(plain)).source).toMatchObject({
      state: 'unavailable',
      fingerprint: null,
      reason: 'not-a-git-repository',
    });
    const empty = await mkdtemp(join(tmpdir(), 'bb-empty-'));
    roots.push(empty);
    git(empty, 'init', '-q');
    expect((await source(empty)).source).toMatchObject({
      state: 'unavailable',
      reason: 'no-commits',
    });
  });
});
