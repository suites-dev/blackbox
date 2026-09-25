import { Duplex, PassThrough } from 'node:stream';
import { expect, it, vi } from 'vitest';
import { dockerExecutionControl } from './docker-control.js';
import type { SandboxContainerExecutionOutcome } from './types.js';

function pendingCompletion(): Promise<SandboxContainerExecutionOutcome> {
  return new Promise(() => undefined);
}

it('writes stdin, closes it, and rejects later input', async () => {
  const stream = new PassThrough();
  const chunks: Buffer[] = [];
  stream.on('data', (chunk: Buffer) => chunks.push(chunk));
  const execution = dockerExecutionControl({
    exec: { resize: () => Promise.resolve() },
    stream,
    terminal: { kind: 'captured' },
    state: { completed: false, stdinEnded: false },
    completion: pendingCompletion(),
  });

  await expect(
    execution.writeStdin({ kind: 'stdin-chunk', chunk: Buffer.from('select 1;') }),
  ).resolves.toEqual({
    kind: 'delivered',
    action: 'stdin-chunk',
    mechanism: 'docker-stream',
  });
  await expect(execution.endStdin()).resolves.toEqual({
    kind: 'delivered',
    action: 'stdin-end',
    mechanism: 'docker-stream',
  });
  await expect(
    execution.writeStdin({ kind: 'stdin-chunk', chunk: Buffer.from('select 2;') }),
  ).resolves.toEqual({ kind: 'rejected', action: 'stdin-chunk', reason: 'stdin-ended' });
  expect(Buffer.concat(chunks).toString()).toBe('select 1;');
});

it('resizes tty executions and reports captured mode honestly', async () => {
  const resize = vi.fn(() => Promise.resolve());
  const state = { completed: false, stdinEnded: false };
  const tty = dockerExecutionControl({
    exec: { resize },
    stream: new PassThrough(),
    terminal: { kind: 'tty', columns: 80, rows: 24 },
    state,
    completion: pendingCompletion(),
  });
  await expect(tty.resize({ columns: 120, rows: 40 })).resolves.toEqual({
    kind: 'delivered',
    action: 'resize',
    mechanism: 'docker-exec-resize',
  });
  expect(resize).toHaveBeenCalledWith({ w: 120, h: 40 });

  const captured = dockerExecutionControl({
    exec: { resize },
    stream: new PassThrough(),
    terminal: { kind: 'captured' },
    state,
    completion: pendingCompletion(),
  });
  await expect(captured.resize({ columns: 120, rows: 40 })).resolves.toEqual({
    kind: 'unsupported',
    action: 'resize',
    reason: 'tty-required',
  });
});

it('delivers only the signals supported by a Docker tty stream', async () => {
  const stream = new PassThrough();
  const chunks: Buffer[] = [];
  stream.on('data', (chunk: Buffer) => chunks.push(chunk));
  const execution = dockerExecutionControl({
    exec: { resize: () => Promise.resolve() },
    stream,
    terminal: { kind: 'tty', columns: 80, rows: 24 },
    state: { completed: false, stdinEnded: false },
    completion: pendingCompletion(),
  });

  await expect(execution.signal({ signal: 'SIGINT' })).resolves.toEqual({
    kind: 'delivered',
    action: 'signal',
    mechanism: 'tty-control-character',
  });
  await expect(execution.signal({ signal: 'SIGQUIT' })).resolves.toEqual({
    kind: 'delivered',
    action: 'signal',
    mechanism: 'tty-control-character',
  });
  await expect(execution.signal({ signal: 'SIGTERM' })).resolves.toEqual({
    kind: 'unsupported',
    action: 'signal',
    reason: 'docker-exec-signal-unsupported',
  });
  expect(Buffer.concat(chunks)).toEqual(Buffer.of(3, 28));
});

it('rejects control after completion and invalid resize dimensions', async () => {
  const resize = vi.fn(() => Promise.resolve());
  const state = { completed: false, stdinEnded: false };
  const execution = dockerExecutionControl({
    exec: { resize },
    stream: new PassThrough(),
    terminal: { kind: 'tty', columns: 80, rows: 24 },
    state,
    completion: pendingCompletion(),
  });
  await expect(execution.resize({ columns: 0, rows: 24 })).resolves.toEqual({
    kind: 'rejected',
    action: 'resize',
    reason: 'invalid-terminal-size',
  });
  state.completed = true;
  await expect(execution.signal({ signal: 'SIGINT' })).resolves.toEqual({
    kind: 'rejected',
    action: 'signal',
    reason: 'execution-completed',
  });
  await expect(execution.endStdin()).resolves.toEqual({
    kind: 'rejected',
    action: 'stdin-end',
    reason: 'execution-completed',
  });
  expect(resize).not.toHaveBeenCalled();
});

it('returns a typed control failure when Docker rejects a resize', async () => {
  const execution = dockerExecutionControl({
    exec: { resize: () => Promise.reject(new Error('resize transport failed')) },
    stream: new PassThrough(),
    terminal: { kind: 'tty', columns: 80, rows: 24 },
    state: { completed: false, stdinEnded: false },
    completion: pendingCompletion(),
  });
  await expect(execution.resize({ columns: 120, rows: 40 })).resolves.toEqual({
    kind: 'failed',
    action: 'resize',
    error: { name: 'Error', message: 'resize transport failed' },
  });
});

it('returns a typed control failure when the stdin stream rejects a write', async () => {
  const stream = new Duplex({
    read() {
      this.push(null);
    },
    write(_chunk, _encoding, callback) {
      callback(new Error('stdin transport failed'));
    },
  });
  stream.on('error', () => undefined);
  const execution = dockerExecutionControl({
    exec: { resize: () => Promise.resolve() },
    stream,
    terminal: { kind: 'captured' },
    state: { completed: false, stdinEnded: false },
    completion: pendingCompletion(),
  });
  await expect(
    execution.writeStdin({ kind: 'stdin-chunk', chunk: Buffer.from('select 1;') }),
  ).resolves.toEqual({
    kind: 'failed',
    action: 'stdin-chunk',
    error: { name: 'Error', message: 'stdin transport failed' },
  });
});
