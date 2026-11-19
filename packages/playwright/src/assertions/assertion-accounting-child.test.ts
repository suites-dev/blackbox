import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, it } from 'vitest';

import { runAssertionProcess } from '../testing/assertion-accounting/native-runner.fixture.js';

it('flushes native child output before returning a nonzero status', async (context) => {
  const directory = await mkdtemp(join(tmpdir(), 'assertion-child-completion-'));
  context.onTestFinished(async () => {
    await rm(directory, { recursive: true, force: true });
  });
  const result = await runAssertionProcess(
    ['-e', 'process.stdout.write("native output"); process.exitCode = 7;'],
    {
      directory,
      cwd: directory,
      env: process.env,
    },
  );
  expect(result).toEqual({ exitCode: 7, output: 'native output' });
  expect(await readFile(join(directory, 'execution.log'), 'utf8')).toBe('native output');
});

it('deadline kills the owned native process group and retains partial output before rejecting', async (context) => {
  const directory = await mkdtemp(join(tmpdir(), 'assertion-child-deadline-'));
  const pidFile = join(directory, 'pid');
  context.onTestFinished(async () => {
    try {
      const pid = Number(await readFile(pidFile, 'utf8'));
      if (process.platform === 'win32') {
        process.kill(pid, 'SIGKILL');
      } else {
        process.kill(-pid, 'SIGKILL');
      }
    } catch (error) {
      if (!(
        error instanceof Error &&
        'code' in error &&
        ['ENOENT', 'ESRCH'].includes(String(error.code))
      )) {
        throw error;
      }
    }
    await rm(directory, { recursive: true, force: true });
  });
  const descendantSource =
    "process.stdout.write('owned descendant ready\\n'); setInterval(() => {}, 1000);";
  const source = `
    require('node:fs').writeFileSync(process.env.ASSERTION_CHILD_PID, String(process.pid));
    if (process.platform !== 'win32') {
      require('node:child_process').spawn(process.execPath,
        ['-e', ${JSON.stringify(descendantSource)}],
        { stdio: 'inherit' });
    }
    process.stdout.write('owned child ready\\n');
    setInterval(() => {}, 1000);
  `;
  await expect(
    runAssertionProcess(
      ['-e', source],
      {
        directory,
        cwd: directory,
        env: { ...process.env, ASSERTION_CHILD_PID: pidFile },
      },
      1500,
    ),
  ).rejects.toThrow(`Native assertion child exceeded 1500ms; evidence: ${directory}`);
  const pid = Number(await readFile(pidFile, 'utf8'));
  expect(() => process.kill(pid, 0)).toThrow(expect.objectContaining({ code: 'ESRCH' }));
  const output = await readFile(join(directory, 'execution.log'), 'utf8');
  expect(output.split('\n').filter(Boolean).sort()).toEqual(
    process.platform === 'win32'
      ? ['owned child ready']
      : ['owned child ready', 'owned descendant ready'],
  );
  // The descendant inherits the output pipe and holds an interval. Completion of
  // runAssertionProcess's close event proves it did not survive its parent.
}, 10_000);
