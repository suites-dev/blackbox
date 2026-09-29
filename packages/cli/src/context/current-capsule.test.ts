import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import {
  clearCurrentCapsuleIf,
  readCurrentCapsule,
  setCurrentCapsule,
  stateDirectory,
} from './current-capsule.js';

const execute = promisify(execFile);
const A = 'calm-comet-ada-000000000001';
const B = 'gentle-willow-zoe-000000000002';
const C = 'rapid-river-noah-000000000003';

async function project(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'bb-current-'));
}

async function holds(directory: string): Promise<string | null> {
  const read = await readCurrentCapsule(directory);
  return read.kind === 'set' ? read.capsule : null;
}

/** Only current-capsule itself may remain: no temp or clearing files. */
async function assertNoLeftovers(directory: string): Promise<void> {
  const files = await readdir(stateDirectory(directory));
  assert.deepEqual(
    files.filter((file) => file !== 'current-capsule'),
    [],
  );
}

void test('missing, malformed and unreadable files read as no usable current capsule', async () => {
  const directory = await project();
  try {
    assert.deepEqual(await readCurrentCapsule(directory), { kind: 'none' });
    await mkdir(stateDirectory(directory), { recursive: true });
    const file = join(stateDirectory(directory), 'current-capsule');
    await writeFile(file, 'not a capsule id\n');
    assert.deepEqual(await readCurrentCapsule(directory), { kind: 'invalid', reason: 'malformed' });
    await unlink(file);
    await mkdir(file);
    assert.deepEqual(await readCurrentCapsule(directory), {
      kind: 'invalid',
      reason: 'unreadable',
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

void test('set writes the capsule ID and a newline; last writer wins', async () => {
  const directory = await project();
  try {
    await setCurrentCapsule(directory, A);
    await setCurrentCapsule(directory, B);
    assert.equal(
      await readFile(join(stateDirectory(directory), 'current-capsule'), 'utf8'),
      `${B}\n`,
    );
    await assertNoLeftovers(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

void test('clearIf(A) clears A and leaves B untouched', async () => {
  const directory = await project();
  try {
    await setCurrentCapsule(directory, A);
    assert.equal(await clearCurrentCapsuleIf(directory, A), 'cleared');
    assert.equal(await holds(directory), null);
    await setCurrentCapsule(directory, B);
    assert.equal(await clearCurrentCapsuleIf(directory, A), 'not-current');
    assert.equal(await holds(directory), B);
    await assertNoLeftovers(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

void test('a set(B) landing between the read and the rename is restored', async () => {
  const directory = await project();
  try {
    await setCurrentCapsule(directory, A);
    const result = await clearCurrentCapsuleIf(directory, A, {
      afterRead: () => setCurrentCapsule(directory, B),
      afterRename: () => Promise.resolve(),
    });
    assert.equal(result, 'restored');
    assert.equal(await holds(directory), B);
    await assertNoLeftovers(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

void test('a set(C) landing after the rename wins over the restore (EEXIST)', async () => {
  const directory = await project();
  try {
    await setCurrentCapsule(directory, A);
    const result = await clearCurrentCapsuleIf(directory, A, {
      afterRead: () => setCurrentCapsule(directory, B),
      afterRename: () => setCurrentCapsule(directory, C),
    });
    assert.equal(result, 'restored');
    assert.equal(await holds(directory), C);
    await assertNoLeftovers(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

void test('negative control: an unconditional clear loses a racing set(B)', async () => {
  const directory = await project();
  try {
    await setCurrentCapsule(directory, A);
    // The plausible wrong implementation: check, then unlink whatever is there.
    const naive = async () => {
      if ((await holds(directory)) === A) {
        await setCurrentCapsule(directory, B);
        await unlink(join(stateDirectory(directory), 'current-capsule'));
      }
    };
    await naive();
    assert.notEqual(await holds(directory), B);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

void test('a symlinked state or .blackbox directory is refused and nothing outside the project changes', async () => {
  for (const linked of ['state', '.blackbox'] as const) {
    const directory = await project();
    const outside = await mkdtemp(join(tmpdir(), 'bb-outside-'));
    try {
      const target = join(outside, 'current-capsule');
      if (linked === 'state') {
        await mkdir(join(directory, '.blackbox'));
        await symlink(outside, join(directory, '.blackbox', 'state'));
      } else {
        await mkdir(join(outside, 'state'));
        await symlink(outside, join(directory, '.blackbox'));
      }
      const external = linked === 'state' ? target : join(outside, 'state', 'current-capsule');
      await writeFile(external, `${A}\n`);
      await assert.rejects(setCurrentCapsule(directory, B), /EUNSAFE writing/u);
      await assert.rejects(clearCurrentCapsuleIf(directory, A), /EUNSAFE clearing/u);
      assert.equal(await readFile(external, 'utf8'), `${A}\n`, linked);
      assert.deepEqual(await readdir(dirname(external)), ['current-capsule'], linked);
    } finally {
      await rm(directory, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  }
});

void test('clearIf without a state directory is not-current and creates nothing', async () => {
  const directory = await project();
  try {
    assert.equal(await clearCurrentCapsuleIf(directory, A), 'not-current');
    assert.deepEqual(await readdir(directory), []);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

void test('reads refuse a symlinked state directory or file; extra content is malformed', async () => {
  const outside = await mkdtemp(join(tmpdir(), 'bb-outside-'));
  try {
    await writeFile(join(outside, 'current-capsule'), `${A}\n`);
    // A symlinked state directory pointing outside the project.
    const linkedState = await project();
    await mkdir(join(linkedState, '.blackbox'));
    await symlink(outside, join(linkedState, '.blackbox', 'state'));
    // A current-capsule file that is itself a symlink to an outside file.
    const linkedFile = await project();
    await mkdir(stateDirectory(linkedFile), { recursive: true });
    await symlink(
      join(outside, 'current-capsule'),
      join(stateDirectory(linkedFile), 'current-capsule'),
    );
    // A valid ID followed by more content. (The 256-byte read bound itself only
    // limits memory on a huge file; it is not observable here.)
    const huge = await project();
    await mkdir(stateDirectory(huge), { recursive: true });
    await writeFile(join(stateDirectory(huge), 'current-capsule'), `${A}\n${'x'.repeat(4096)}`);
    assert.deepEqual(await readCurrentCapsule(linkedState), {
      kind: 'invalid',
      reason: 'unreadable',
    });
    assert.deepEqual(await readCurrentCapsule(linkedFile), {
      kind: 'invalid',
      reason: 'unreadable',
    });
    assert.deepEqual(await readCurrentCapsule(huge), { kind: 'invalid', reason: 'malformed' });
    for (const directory of [linkedState, linkedFile, huge]) {
      await rm(directory, { recursive: true, force: true });
    }
  } finally {
    await rm(outside, { recursive: true, force: true });
  }
});

void test(
  'a FIFO in place of the file reads as unreadable without blocking',
  // mkfifo does not exist on Windows.
  { skip: process.platform === 'win32' ? 'POSIX FIFOs only' : false, timeout: 10_000 },
  async () => {
    const directory = await project();
    try {
      await mkdir(stateDirectory(directory), { recursive: true });
      await execute('mkfifo', [join(stateDirectory(directory), 'current-capsule')]);
      assert.deepEqual(await readCurrentCapsule(directory), {
        kind: 'invalid',
        reason: 'unreadable',
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);
