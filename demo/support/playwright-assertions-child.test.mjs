import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { assertionChild } from './playwright-assertions-child.mjs';

async function fixture(context, source) {
  const root = await mkdtemp(join(tmpdir(), 'assertion-child-'));
  context.after(async () => {
    try {
      const pid = Number(await readFile(join(root, 'pid'), 'utf8'));
      if (process.platform === 'win32') process.kill(pid, 'SIGKILL');
      else process.kill(-pid, 'SIGKILL');
    } catch (error) {
      if (!['ENOENT', 'ESRCH'].includes(error.code)) throw error;
    }
    await rm(root, { recursive: true, force: true });
  });
  await mkdir(join(root, 'node_modules/.bin'), { recursive: true });
  const executable = join(root, 'node_modules/.bin/playwright');
  await writeFile(executable, `#!${process.execPath}\n${source}\n`);
  await chmod(executable, 0o755);
  return root;
}

test('child completion flushes the native command output before returning its status', async (context) => {
  const root = await fixture(
    context,
    'process.stdout.write("native command completed\\n"); process.exitCode = 1;',
  );
  const child = assertionChild(root, root, {});
  assert.equal(await child.run([], 'execution.txt'), 1);
  assert.equal(await readFile(join(root, 'execution.txt'), 'utf8'), 'native command completed\n');
});

test(
  'deadline interrupts then force-kills only the owned unresponsive child and flushes logs',
  { timeout: 10_000 },
  async (context) => {
    const root = await fixture(
      context,
      `
    process.on('SIGINT', () => process.stdout.write('ignored interrupt\\n'));
    process.stdout.write('owned child ready\\n');
    require('node:fs').writeFileSync(process.env.PID_FILE, String(process.pid));
    setInterval(() => {}, 1000);
  `,
    );
    const pidFile = join(root, 'pid');
    const child = assertionChild(
      root,
      root,
      { PID_FILE: pidFile },
      { deadlineMs: 1_500, interruptMs: 50 },
    );
    await assert.rejects(child.run([], 'execution.txt'), /exceeded 1500 milliseconds/u);
    const pid = Number(await readFile(pidFile, 'utf8'));
    assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
    const log = await readFile(join(root, 'execution.txt'), 'utf8');
    assert.match(log, /owned child ready/u);
    assert.match(log, /ignored interrupt/u);
    assert.equal(child.interrupted, true);
  },
);

test('cancellation before launch starts no native command', async (context) => {
  const root = await fixture(context, 'throw new Error("must not execute");');
  const child = assertionChild(root, root, {});
  child.interrupt();
  await assert.rejects(child.run([], 'execution.txt'), /interrupted/u);
  await assert.rejects(readFile(join(root, 'execution.txt')), { code: 'ENOENT' });
});
