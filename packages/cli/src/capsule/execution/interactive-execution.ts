import type { Readable, Writable } from 'node:stream';

import {
  execCapsuleInteractive,
  type CapsuleExecInput,
  type CapsuleExecResult,
  type CapsuleInteractiveControlResult,
  type CapsuleInteractiveEvent,
  type CapsuleInteractiveExecInput,
  type CapsuleTerminalSize,
} from '@suites/blackbox-capsule-internal';

import { ControlQueue } from './control-queue.js';

type ExecuteInteractive = (input: CapsuleInteractiveExecInput) => Promise<CapsuleExecResult>;

export interface InteractiveTerminalPorts {
  readonly stdin: Readable;
  readonly stdout: Writable;
  readonly stderr: Writable;
  readonly terminalMode:
    | { readonly kind: 'raw-mode-unavailable' }
    | {
        readonly kind: 'raw-mode';
        readonly isRaw: () => boolean;
        readonly setRawMode: (enabled: boolean) => void;
      };
  readonly readTerminalSize: () => CapsuleTerminalSize;
  readonly addResizeListener: (listener: () => void) => void;
  readonly removeResizeListener: (listener: () => void) => void;
  readonly addSignalListener: (signal: 'SIGINT' | 'SIGQUIT', listener: () => void) => void;
  readonly removeSignalListener: (signal: 'SIGINT' | 'SIGQUIT', listener: () => void) => void;
}

interface InteractiveExecInput extends CapsuleExecInput {
  readonly ports: InteractiveTerminalPorts;
  readonly execute: ExecuteInteractive;
}

function terminalSize(): CapsuleTerminalSize {
  const columns = process.stdout.columns;
  const rows = process.stdout.rows;
  return {
    columns: Number.isInteger(columns) && columns > 0 ? columns : 80,
    rows: Number.isInteger(rows) && rows > 0 ? rows : 24,
  };
}

export function processTerminalPorts(): InteractiveTerminalPorts {
  const terminalMode = process.stdin.isTTY
    ? {
        kind: 'raw-mode' as const,
        isRaw: () => process.stdin.isRaw,
        setRawMode: (enabled: boolean) => {
          process.stdin.setRawMode(enabled);
        },
      }
    : { kind: 'raw-mode-unavailable' as const };
  return {
    stdin: process.stdin,
    stdout: process.stdout,
    stderr: process.stderr,
    terminalMode,
    readTerminalSize: terminalSize,
    addResizeListener: (listener) => {
      process.stdout.on('resize', listener);
    },
    removeResizeListener: (listener) => {
      process.stdout.off('resize', listener);
    },
    addSignalListener: (signal, listener) => {
      process.on(signal, listener);
    },
    removeSignalListener: (signal, listener) => {
      process.off(signal, listener);
    },
  };
}

function enterTerminalMode(ports: InteractiveTerminalPorts): () => void {
  if (ports.terminalMode.kind === 'raw-mode-unavailable') {
    return () => undefined;
  }
  const terminalMode = ports.terminalMode;
  const wasRaw = terminalMode.isRaw();
  if (!wasRaw) {
    terminalMode.setRawMode(true);
  }
  return () => {
    if (!wasRaw) {
      terminalMode.setRawMode(false);
    }
  };
}

function controlMessage(result: CapsuleInteractiveControlResult): string | null {
  switch (result.kind) {
    case 'delivered':
      return null;
    case 'unsupported':
      return `[blackbox] ${result.action} unsupported: ${result.reason}\n`;
    case 'rejected':
      return `[blackbox] ${result.action} rejected: ${result.reason}\n`;
    case 'failed':
      return `[blackbox] ${result.action} failed: ${result.error.message}\n`;
  }
}

function writeEvent(ports: InteractiveTerminalPorts, event: CapsuleInteractiveEvent): void {
  if (event.kind === 'output') {
    const destination = event.stream === 'stderr' ? ports.stderr : ports.stdout;
    destination.write(Buffer.from(event.chunk));
    return;
  }
  const message = controlMessage(event.result);
  if (message !== null) {
    ports.stderr.write(message);
  }
}

type ControlWithoutId =
  | { readonly kind: 'stdin-chunk'; readonly chunk: Uint8Array }
  | { readonly kind: 'stdin-end' }
  | { readonly kind: 'resize'; readonly size: CapsuleTerminalSize }
  | { readonly kind: 'signal'; readonly signal: 'SIGINT' | 'SIGQUIT' };

function controlFactory(queue: ControlQueue) {
  let sequence = 0;
  return (control: ControlWithoutId): void => {
    sequence += 1;
    const controlId = `terminal-${String(sequence)}`;
    switch (control.kind) {
      case 'stdin-chunk':
        queue.push({ kind: 'stdin-chunk', controlId, chunk: control.chunk });
        break;
      case 'stdin-end':
        queue.push({ kind: 'stdin-end', controlId });
        break;
      case 'resize':
        queue.push({ kind: 'resize', controlId, size: control.size });
        break;
      case 'signal':
        queue.push({ kind: 'signal', controlId, signal: control.signal });
        break;
    }
  };
}

export async function runInteractiveCapsuleExec(
  input: InteractiveExecInput,
): Promise<CapsuleExecResult> {
  const queue = new ControlQueue();
  const send = controlFactory(queue);
  const wasPaused = input.ports.stdin.isPaused();
  const restoreTerminalMode = enterTerminalMode(input.ports);
  const onData = (chunk: Buffer | string) => {
    send({ kind: 'stdin-chunk', chunk: Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk) });
  };
  const onEnd = () => {
    send({ kind: 'stdin-end' });
  };
  const onResize = () => {
    send({ kind: 'resize', size: input.ports.readTerminalSize() });
  };
  const onSigint = () => {
    send({ kind: 'signal', signal: 'SIGINT' });
  };
  const onSigquit = () => {
    send({ kind: 'signal', signal: 'SIGQUIT' });
  };
  try {
    input.ports.stdin.on('data', onData);
    input.ports.stdin.on('end', onEnd);
    input.ports.addResizeListener(onResize);
    input.ports.addSignalListener('SIGINT', onSigint);
    input.ports.addSignalListener('SIGQUIT', onSigquit);
    input.ports.stdin.resume();
    return await input.execute({
      projectDirectory: input.projectDirectory,
      sessionId: input.sessionId,
      name: input.name,
      purpose: input.purpose,
      target: input.target,
      terminal: input.ports.readTerminalSize(),
      controls: queue,
      onEvent: (event) => {
        writeEvent(input.ports, event);
      },
    });
  } finally {
    queue.close();
    input.ports.stdin.off('data', onData);
    input.ports.stdin.off('end', onEnd);
    input.ports.removeResizeListener(onResize);
    input.ports.removeSignalListener('SIGINT', onSigint);
    input.ports.removeSignalListener('SIGQUIT', onSigquit);
    if (wasPaused) {
      input.ports.stdin.pause();
    }
    restoreTerminalMode();
  }
}

export function runProcessInteractiveCapsuleExec(
  input: CapsuleExecInput,
): Promise<CapsuleExecResult> {
  return runInteractiveCapsuleExec({
    ...input,
    ports: processTerminalPorts(),
    execute: execCapsuleInteractive,
  });
}
