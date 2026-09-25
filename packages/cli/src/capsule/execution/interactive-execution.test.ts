import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import test from 'node:test';

import type {
  CapsuleInteractiveControl,
  CapsuleInteractiveExecInput,
} from '@suites/blackbox-capsule-internal';

import {
  runInteractiveCapsuleExec,
  type InteractiveTerminalPorts,
} from './interactive-execution.js';

function retainedEmpty() {
  return {
    stdout: { kind: 'complete' as const, originalBytes: 0 },
    stderr: { kind: 'complete' as const, originalBytes: 0 },
  };
}

function terminalFixture() {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const terminal = new EventEmitter();
  const ports = {
    stdin,
    stdout,
    stderr,
    readTerminalSize: () => ({ columns: 100, rows: 30 }),
    addResizeListener: (listener: () => void) => {
      terminal.on('resize', listener);
    },
    removeResizeListener: (listener: () => void) => {
      terminal.off('resize', listener);
    },
    addSignalListener: (signal: 'SIGINT' | 'SIGQUIT', listener: () => void) => {
      terminal.on(signal, listener);
    },
    removeSignalListener: (signal: 'SIGINT' | 'SIGQUIT', listener: () => void) => {
      terminal.off(signal, listener);
    },
  } satisfies InteractiveTerminalPorts;
  return { stdin, stdout, stderr, terminal, ports };
}

void test('streams output and forwards terminal controls without retaining input', async () => {
  const fixture = terminalFixture();
  const output: Buffer[] = [];
  const diagnostics: Buffer[] = [];
  fixture.stdout.on('data', (chunk: Buffer) => output.push(chunk));
  fixture.stderr.on('data', (chunk: Buffer) => diagnostics.push(chunk));
  const controls: CapsuleInteractiveControl[] = [];
  let controlsReady: () => void = () => undefined;
  const collected = new Promise<void>((resolve) => {
    controlsReady = resolve;
  });
  const execute = async (input: CapsuleInteractiveExecInput) => {
    input.onEvent({ kind: 'output', stream: 'stdout', chunk: Buffer.from('live-output') });
    const iterator = input.controls[Symbol.asyncIterator]();
    for (let index = 0; index < 4; index += 1) {
      const next = await iterator.next();
      if (!next.done) {
        controls.push(next.value);
      }
    }
    input.onEvent({
      kind: 'control-result',
      controlId: 'terminal-visible',
      result: { kind: 'unsupported', action: 'resize', reason: 'host-pty-unavailable' },
    });
    controlsReady();
    return {
      kind: 'capsule-exec-completed' as const,
      activityId: '00000000-0000-4000-8000-000000000042',
      outcome: {
        kind: 'exited' as const,
        argv: ['cat'],
        location: { kind: 'host' as const },
        exitCode: 0,
        stdout: 'live-output',
        stderr: '',
        retention: retainedEmpty(),
      },
    };
  };
  const running = runInteractiveCapsuleExec({
    projectDirectory: process.cwd(),
    sessionId: 'quiet-river-ada',
    purpose: 'stimulus',
    target: { kind: 'host', argv: ['cat'] },
    ports: fixture.ports,
    execute,
  });
  fixture.stdin.write('typed-value');
  fixture.terminal.emit('resize');
  fixture.terminal.emit('SIGINT');
  fixture.terminal.emit('SIGQUIT');
  await collected;
  const result = await running;
  assert.equal(Buffer.concat(output).toString(), 'live-output');
  assert.match(Buffer.concat(diagnostics).toString(), /host-pty-unavailable/u);
  assert.deepEqual(
    controls.map((control) => control.kind),
    ['stdin-chunk', 'resize', 'signal', 'signal'],
  );
  const first = controls[0];
  assert.equal(first.kind, 'stdin-chunk');
  assert.equal(Buffer.from(first.chunk).toString(), 'typed-value');
  assert.equal(JSON.stringify(result).includes('typed-value'), false);
});
