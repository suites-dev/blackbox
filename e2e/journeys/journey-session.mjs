// One persistent bash process per journey (set +e), so shell variables and $?
// survive between golden lines. After each command the runner reports the
// status on a dedicated fd 3, so the sentinel never enters compared output,
// and restores $? before the next line.
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';

export const STATUS_SENTINEL =
  '__bb_s=$?; printf \'__BB_STATUS__:%s\\n\' "$__bb_s" >&3; printf \'%s\\n\' "$__bb_fence"; (exit "$__bb_s")';

export class JourneySessionTimeout extends Error {}

/** The real shell. Tests inject a fake through `spawnShell` to force races. */
function spawnBash({ cwd, env }) {
  return spawn('bash', ['--noprofile', '--norc'], {
    cwd,
    env,
    detached: true,
    stdio: ['pipe', 'pipe', 'pipe', 'pipe'],
  });
}

export class BashSession {
  #child;
  #stdout = '';
  #status = '';
  #fence;
  #sentinel;
  #waiters = new Set();
  #exited = false;
  #killed = false;

  constructor({ cwd, env, sentinel = STATUS_SENTINEL, spawnShell = spawnBash }) {
    this.#fence = `__BB_FENCE_${randomBytes(8).toString('hex')}__`;
    this.#sentinel = sentinel;
    this.#child = spawnShell({ cwd, env });
    this.#child.stdout.setEncoding('utf8').on('data', (chunk) => {
      this.#stdout += chunk;
      this.#wake();
    });
    this.#child.stdio[3].setEncoding('utf8').on('data', (chunk) => {
      this.#status += chunk;
      this.#wake();
    });
    this.#child.stderr.setEncoding('utf8').on('data', (chunk) => {
      // Only bash's own startup errors can reach here: every command runs
      // after `exec 2>&1`, so its stderr is interleaved into stdout in order.
      this.#stdout += chunk;
      this.#wake();
    });
    this.#child.once('exit', () => {
      this.#exited = true;
      this.#wake();
    });
    // A killed or exiting shell closes its stdin; a late write then fails with
    // EPIPE. That is never the journey's result (the timeout or exit is), so
    // stdin errors are absorbed here instead of crashing the runner.
    this.#child.stdin.on('error', () => {});
    this.#child.stdin.write(`set +e\nexec 2>&1\n__bb_fence='${this.#fence}'\n`);
  }

  #wake() {
    for (const waiter of this.#waiters) waiter();
  }

  /** Runs one command line; resolves with its combined output and exit status. */
  async run(command, timeoutMs) {
    this.#child.stdin.write(`{ ${command}\n} </dev/null\n${this.#sentinel}\n`);
    return new Promise((resolve, reject) => {
      const check = () => {
        const statusMatch = /^__BB_STATUS__:(\d+)\n/u.exec(this.#status);
        const fenceLine = `${this.#fence}\n`;
        const fenceAt = this.#stdout.indexOf(fenceLine);
        if (statusMatch !== null && fenceAt >= 0) {
          finish();
          const output = this.#stdout.slice(0, fenceAt);
          this.#stdout = this.#stdout.slice(fenceAt + fenceLine.length);
          this.#status = this.#status.slice(statusMatch[0].length);
          resolve({ output, status: Number(statusMatch[1]) });
        } else if (this.#exited) {
          finish();
          reject(new Error(`bash exited while running: ${command}\n${this.#stdout}`));
        }
      };
      const timer = setTimeout(() => {
        finish();
        this.kill();
        reject(
          new JourneySessionTimeout(`timed out after ${timeoutMs} ms: ${command}\n${this.#stdout}`),
        );
      }, timeoutMs);
      const finish = () => {
        clearTimeout(timer);
        this.#waiters.delete(check);
      };
      this.#waiters.add(check);
      check();
    });
  }

  kill() {
    if (this.#exited) return;
    this.#killed = true;
    try {
      process.kill(-this.#child.pid, 'SIGKILL');
    } catch (error) {
      if (error.code !== 'ESRCH') throw error;
    }
  }

  async close() {
    if (this.#exited) return;
    const exited = new Promise((resolve) => this.#child.once('exit', resolve));
    // After a timeout the shell was already killed: wait for its exit, never
    // write to its closed stdin.
    if (!this.#killed && this.#child.stdin.writable) {
      this.#child.stdin.end('exit 0\n');
    }
    const timer = setTimeout(() => this.kill(), 5000);
    await exited;
    clearTimeout(timer);
  }
}
