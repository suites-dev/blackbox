import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { join } from 'node:path';

/** Bound interruption to this runner's own native Playwright process group. */
export function assertionChild(
  consumerRoot,
  resultsRoot,
  environment,
  { deadlineMs = 90_000, interruptMs = 15_000 } = {},
) {
  let child;
  let killTimer;
  let interrupted = false;
  const kill = (signal) => {
    if (child?.pid === undefined) return;
    try {
      if (process.platform === 'win32') child.kill(signal);
      else process.kill(-child.pid, signal);
    } catch (error) {
      if (error.code !== 'ESRCH') throw error;
    }
  };
  const interrupt = () => {
    interrupted = true;
    if (child?.pid === undefined) return;
    kill('SIGINT');
    killTimer ??= setTimeout(() => kill('SIGKILL'), interruptMs);
    killTimer.unref();
  };
  const run = (arguments_, name) =>
    new Promise((resolve, reject) => {
      if (interrupted) {
        reject(new Error('Assertion consumer interrupted'));
        return;
      }
      const log = createWriteStream(join(resultsRoot, name), { flags: 'wx' });
      let failure;
      const deadline = setTimeout(() => {
        failure = new Error(`Assertion Playwright process exceeded ${deadlineMs} milliseconds`);
        interrupt();
      }, deadlineMs);
      deadline.unref();
      child = spawn(join(consumerRoot, 'node_modules/.bin/playwright'), arguments_, {
        cwd: consumerRoot,
        env: { ...process.env, ...environment },
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: process.platform !== 'win32',
        shell: false,
      });
      for (const stream of [child.stdout, child.stderr]) {
        stream.on('data', (chunk) => {
          log.write(chunk);
          process.stdout.write(chunk);
        });
      }
      log.once('error', (error) => {
        failure = error;
        interrupt();
      });
      child.once('error', (error) => {
        failure = error;
      });
      child.once('close', (code, signal) => {
        child = undefined;
        clearTimeout(deadline);
        clearTimeout(killTimer);
        killTimer = undefined;
        log.end((error) => {
          if (failure ?? error) reject(failure ?? error);
          else if (interrupted || signal !== null)
            reject(new Error(`Assertion consumer interrupted: ${signal}`));
          else resolve(code);
        });
      });
    });
  return {
    run,
    interrupt,
    get interrupted() {
      return interrupted;
    },
  };
}
