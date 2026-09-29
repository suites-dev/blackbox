import assert from 'node:assert/strict';
import { fork, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { readCurrentCapsule, setCurrentCapsule } from './current-capsule.js';

const A = 'calm-comet-ada-000000000001';
const B = 'gentle-willow-zoe-000000000002';
const ITERATIONS = 200;

/** A long-lived worker process that runs one current-capsule operation per message. */
const WORKER = `
import { clearCurrentCapsuleIf, setCurrentCapsule } from ${JSON.stringify(
  new URL('./current-capsule.js', import.meta.url).href,
)};
const [operation, directory, capsule] = process.argv.slice(2);
process.on('message', async () => {
  const jitter = Math.floor(Math.random() * 3);
  await new Promise((resolve) => setTimeout(resolve, jitter));
  const result =
    operation === 'clear'
      ? await clearCurrentCapsuleIf(directory, capsule)
      : (await setCurrentCapsule(directory, capsule), 'set');
  process.send(result);
});
process.send('ready');
`;

function next(child: ChildProcess): Promise<string> {
  return new Promise((resolve) => {
    child.once('message', (message: string) => {
      resolve(message);
    });
  });
}

void test(`down A racing use B in real processes always leaves B (${String(ITERATIONS)} runs)`, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'bb-current-race-'));
  const script = join(directory, 'worker.mjs');
  await writeFile(script, WORKER);
  const clearer = fork(script, ['clear', directory, A]);
  const setter = fork(script, ['set', directory, B]);
  try {
    await Promise.all([next(clearer), next(setter)]);
    const outcomes = new Map<string, number>();
    for (let iteration = 0; iteration < ITERATIONS; iteration += 1) {
      await setCurrentCapsule(directory, A);
      const results = Promise.all([next(clearer), next(setter)]);
      clearer.send('go');
      setter.send('go');
      const [cleared] = await results;
      outcomes.set(cleared, (outcomes.get(cleared) ?? 0) + 1);
      const read = await readCurrentCapsule(directory);
      assert.deepEqual(
        read,
        { kind: 'set', capsule: B },
        `iteration ${String(iteration)}: ${cleared}`,
      );
    }
    assert.equal(
      [...outcomes.values()].reduce((sum, count) => sum + count, 0),
      ITERATIONS,
    );
  } finally {
    clearer.kill();
    setter.kill();
    await rm(directory, { recursive: true, force: true });
  }
});
