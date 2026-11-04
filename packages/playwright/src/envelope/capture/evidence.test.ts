import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { digestBytes } from '../canonical.js';
import { remove } from './capture.fixture.js';
import { currentEvidenceDigest, fragmentsDigest, retainedEvidence } from './evidence.js';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map(remove));
});

async function attempt(fragments: Record<string, string>) {
  const root = await mkdtemp(join(tmpdir(), 'bb-evidence-'));
  roots.push(root);
  const record = join(root, 'blackbox', 'attempt.json');
  const collector = join(root, 'blackbox', 'attempt.compose', 'collector');
  const run = join(collector, 'session', 'execution');
  await mkdir(join(run, 'fragments'), { recursive: true });
  await writeFile(record, '{"sandboxId":"attempt"}');
  await writeFile(join(run, 'collector-lifecycle.json'), '{"revision":1}');
  for (const [name, text] of Object.entries(fragments)) {
    await writeFile(join(run, 'fragments', name), text);
  }
  return { root, record, collector };
}

describe('retained evidence references', () => {
  it('reduces each retained file to a content digest and a path relative to the test output', async () => {
    const found = await attempt({ '1.json': 'a', '2.json': 'b' });
    const refs = await retainedEvidence({
      root: found.root,
      sandboxRecord: found.record,
      collectorDirectory: found.collector,
    });
    expect(refs.map(({ kind }) => kind).sort()).toEqual([
      'collector-fragments',
      'collector-lifecycle',
      'sandbox-record',
    ]);
    const record = refs.find(({ kind }) => kind === 'sandbox-record');
    expect(record).toMatchObject({
      id: digestBytes('{"sandboxId":"attempt"}'),
      locator: { type: 'file', root: 'test-output', path: 'blackbox/attempt.json' },
    });
    expect(JSON.stringify(refs)).not.toContain(found.root);
  });

  it('changes the fragment reference when any fragment changes, and not otherwise', async () => {
    const one = await attempt({ '1.json': 'a', '2.json': 'b' });
    const same = await attempt({ '2.json': 'b', '1.json': 'a' });
    const edited = await attempt({ '1.json': 'a', '2.json': 'B' });
    const ids = async (found: Awaited<ReturnType<typeof attempt>>) =>
      (
        await retainedEvidence({
          root: found.root,
          sandboxRecord: found.record,
          collectorDirectory: found.collector,
        })
      )
        .filter(({ kind }) => kind === 'collector-fragments')
        .map(({ id }) => id);
    expect(await ids(same)).toEqual(await ids(one));
    expect(await ids(edited)).not.toEqual(await ids(one));
  });

  it('omits what is not there instead of inventing a reference', async () => {
    const refs = await retainedEvidence({
      root: tmpdir(),
      sandboxRecord: join(tmpdir(), 'bb-missing.json'),
      collectorDirectory: join(tmpdir(), 'bb-missing-collector'),
    });
    expect(refs).toEqual([]);
  });
});

describe('retained evidence that is not an ordinary file', () => {
  it('never follows a symbolic link when it reads fragments, at capture or at verification', async () => {
    const found = await attempt({ '1.json': 'a' });
    const outside = join(found.root, 'outside.txt');
    await writeFile(outside, 'outside bytes');
    const fragments = join(found.collector, 'session', 'execution', 'fragments');
    const capture = () =>
      retainedEvidence({
        root: found.root,
        sandboxRecord: found.record,
        collectorDirectory: found.collector,
      });
    const before = (await capture()).find(({ kind }) => kind === 'collector-fragments');
    await symlink(outside, join(fragments, '2.json'));
    const after = (await capture()).find(({ kind }) => kind === 'collector-fragments');
    expect(after).toEqual(before);
    if (before === undefined) {
      throw new Error('fixture has no fragments reference');
    }
    expect(await fragmentsDigest(fragments)).toBe(before.id);
    expect(await currentEvidenceDigest(found.root, before)).toBe(before.id);
  });

  it('reports fragments whose only entries are links as missing', async () => {
    const found = await attempt({});
    const outside = join(found.root, 'outside.txt');
    await writeFile(outside, 'outside bytes');
    const fragments = join(found.collector, 'session', 'execution', 'fragments');
    await symlink(outside, join(fragments, '1.json'));
    expect(await fragmentsDigest(fragments)).toBeNull();
  });

  it('reports a pipe in place of evidence as unavailable instead of waiting on it', async () => {
    const found = await attempt({});
    const pipe = join(found.root, 'blackbox', 'pipe.json');
    execFileSync('mkfifo', [pipe]);
    const ref = {
      id: digestBytes('x'),
      kind: 'sandbox-record',
      bytes: 1,
      locator: { type: 'file', root: 'test-output', path: 'blackbox/pipe.json' },
    } as const;
    expect(await currentEvidenceDigest(found.root, ref)).toBeNull();
  });
});
