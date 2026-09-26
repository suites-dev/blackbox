import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { resetCapsuleDemo } from './capsule-reset.mjs';

async function fixture(context) {
  const projectDirectory = await mkdtemp(join(tmpdir(), 'bb-demo-reset-'));
  context.after(() => rm(projectDirectory, { recursive: true, force: true }));
  const runtime = join(projectDirectory, '.blackbox');
  for (const name of [
    'reports',
    'experiments',
    'tmp',
    'instrumentation',
    'clients',
    'drivers',
    'compose',
    's',
  ]) {
    await mkdir(join(runtime, name), { recursive: true });
  }
  await writeFile(join(runtime, 'drivers', 'postgres.mjs'), 'project driver');
  await writeFile(join(runtime, 'drivers', 'package.json'), 'generated package');
  await mkdir(join(runtime, 'drivers', 'node_modules'));
  await writeFile(join(projectDirectory, 'blackbox.config.yaml'), 'catalog');
  await writeFile(join(runtime, 'compose', 'sut.yaml'), 'compose');
  return { projectDirectory, runtime };
}

async function session(input) {
  const sessionId = 'bright-river-ada-123456789012';
  const directory = join(input.runtime, 'experiments', `capsule-${sessionId}`);
  await mkdir(directory);
  await writeFile(join(directory, 'session.json'), JSON.stringify({
    sessionId, state: input.state, cleanup: { kind: input.cleanup },
  }));
}

void test('reset releases an active session before deleting only demo outputs and can repeat', async (context) => {
  const input = await fixture(context);
  await session({ ...input, state: 'running', cleanup: 'not-attempted' });
  const stopped = [];
  await resetCapsuleDemo({ ...input, stopSession: async ({ sessionId }) => {
    assert.ok((await readdir(join(input.runtime, 'experiments'))).length);
    stopped.push(sessionId);
  } });
  assert.deepEqual(stopped, ['bright-river-ada-123456789012']);
  assert.deepEqual((await readdir(input.runtime)).sort(), ['compose', 'drivers']);
  assert.deepEqual(await readdir(join(input.runtime, 'drivers')), ['postgres.mjs']);
  assert.equal(await readFile(join(input.runtime, 'compose', 'sut.yaml'), 'utf8'), 'compose');
  assert.equal(await readFile(join(input.projectDirectory, 'blackbox.config.yaml'), 'utf8'), 'catalog');
  await resetCapsuleDemo({ ...input, stopSession: async () => assert.fail('No active session') });
});

void test('failed cleanup preserves artifacts and temporary manager coordinates', async (context) => {
  const input = await fixture(context);
  await session({ ...input, state: 'running', cleanup: 'not-attempted' });
  await assert.rejects(resetCapsuleDemo({ ...input, stopSession: async () => { throw new Error('manager unavailable'); } }), /manager unavailable/u);
  assert.deepEqual(
    (await readdir(input.runtime)).sort(),
    ['clients', 'compose', 'drivers', 'experiments', 'instrumentation', 'reports', 's', 'tmp'],
  );
});

void test('unconfirmed failed startup cannot lose its resource records', async (context) => {
  const input = await fixture(context);
  await session({ ...input, state: 'start-failed', cleanup: 'failed' });
  await assert.rejects(resetCapsuleDemo({ ...input, stopSession: async () => assert.fail('Not running') }), /unconfirmed cleanup/u);
  assert.ok((await readdir(input.runtime)).includes('experiments'));
});

void test('a symlinked runtime root is rejected without touching its target', async (context) => {
  const input = await fixture(context);
  const other = await fixture(context);
  await rm(input.runtime, { recursive: true });
  await symlink(other.runtime, input.runtime);
  await assert.rejects(resetCapsuleDemo({ ...input, stopSession: async () => assert.fail('Not running') }), /real directory/u);
  assert.equal(await readFile(join(other.runtime, 'compose', 'sut.yaml'), 'utf8'), 'compose');
});

void test('a symlinked project-driver directory is rejected without touching its target', async (context) => {
  const input = await fixture(context);
  const other = await fixture(context);
  await rm(join(input.runtime, 'drivers'), { recursive: true });
  await symlink(join(other.runtime, 'drivers'), join(input.runtime, 'drivers'));
  await assert.rejects(
    resetCapsuleDemo({ ...input, stopSession: async () => assert.fail('Not running') }),
    /real directory/u,
  );
  assert.equal(
    await readFile(join(other.runtime, 'drivers', 'package.json'), 'utf8'),
    'generated package',
  );
});
