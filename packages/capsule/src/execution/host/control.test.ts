import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { tmpdir } from 'node:os';

import { expect, it } from 'vitest';

import { pumpHostControls } from './control.js';

function withinDeadline(operation: Promise<void>): Promise<void> {
  const deadline = new Promise<never>((_, reject) => {
    AbortSignal.timeout(500).addEventListener('abort', () => {
      reject(new Error('cancellation remained behind the blocked stdin write'));
    });
  });
  return Promise.race([operation, deadline]);
}

it.skipIf(process.platform === 'win32')(
  'lets out-of-band cancellation preempt a blocked host stdin callback',
  async () => {
    const child = spawn(
      process.execPath,
      ['-e', 'process.on("SIGINT", () => undefined); setInterval(() => undefined, 1000)'],
      { cwd: tmpdir(), detached: true, stdio: ['pipe', 'pipe', 'pipe'] },
    );
    child.stdin.on('error', () => undefined);
    const closed = once(child, 'close');
    let enteredWrite: () => void = () => undefined;
    const writeStarted = new Promise<void>((resolve) => {
      enteredWrite = resolve;
    });
    Object.defineProperty(child.stdin, 'write', {
      configurable: true,
      value: (_chunk: Uint8Array, _callback: (error: Error) => void) => {
        enteredWrite();
        return false;
      },
    });
    const cancellation = new AbortController();
    async function* controls() {
      await Promise.resolve();
      yield { kind: 'stdin-chunk' as const, controlId: 'blocked', chunk: Buffer.alloc(1024) };
      yield { kind: 'force-terminate' as const, controlId: 'cancelled' };
    }
    const pump = pumpHostControls({
      child,
      state: { completed: false, stdinEnded: false },
      interaction: {
        kind: 'interactive',
        cancellation: { kind: 'abort-signal', signal: cancellation.signal },
        terminal: { columns: 80, rows: 24 },
        controls: controls(),
        onEvent: () => Promise.resolve(),
      },
    });
    try {
      await writeStarted;
      cancellation.abort();
      await expect(withinDeadline(pump)).resolves.toBeUndefined();
    } finally {
      if (child.pid !== undefined) {
        try {
          process.kill(-child.pid, 'SIGKILL');
        } catch {
          /* Already terminated. */
        }
      }
      await closed;
    }
  },
);
