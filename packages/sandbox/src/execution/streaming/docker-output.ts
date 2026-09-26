import { Writable, type Duplex } from 'node:stream';

import type { SandboxContainerExecutionInput, SandboxContainerOutputEvent } from './types.js';

export interface DockerOutputObservation {
  readonly diagnostics: { text: string };
  settled(): Promise<void>;
}

function retainDiagnostic(target: { text: string }, chunk: Buffer): void {
  const limit = 65_536;
  target.text = `${target.text}${chunk.toString('utf8')}`.slice(-limit);
}

function deliver(input: {
  readonly request: SandboxContainerExecutionInput;
  readonly kind: SandboxContainerOutputEvent['kind'];
  readonly chunk: Buffer;
}): Promise<void> {
  const event = {
    kind: input.kind,
    chunk: new Uint8Array(input.chunk),
  } satisfies SandboxContainerOutputEvent;
  return Promise.resolve()
    .then(async () => {
      await input.request.onOutput(event);
    })
    .catch(() => undefined);
}

function outputSink(input: {
  readonly request: SandboxContainerExecutionInput;
  readonly kind: 'stdout' | 'stderr';
  readonly diagnostics: { text: string };
  readonly pending: Set<Promise<void>>;
}): Writable {
  return new Writable({
    write(chunk: Buffer, _encoding, callback) {
      retainDiagnostic(input.diagnostics, chunk);
      const delivery = deliver({ request: input.request, kind: input.kind, chunk });
      input.pending.add(delivery);
      void delivery.finally(() => {
        input.pending.delete(delivery);
        callback();
      });
    },
  });
}

function attachTtyOutput(input: {
  readonly stream: Duplex;
  readonly request: SandboxContainerExecutionInput;
  readonly diagnostics: { text: string };
  readonly pending: Set<Promise<void>>;
}): void {
  input.stream.on('data', (chunk: Buffer) => {
    retainDiagnostic(input.diagnostics, chunk);
    input.stream.pause();
    const delivery = deliver({ request: input.request, kind: 'terminal-output', chunk });
    input.pending.add(delivery);
    void delivery.finally(() => {
      input.pending.delete(delivery);
      if (!input.stream.destroyed) {
        input.stream.resume();
      }
    });
  });
}

export function attachDockerOutput(input: {
  readonly stream: Duplex;
  readonly request: SandboxContainerExecutionInput;
  readonly demux: (input: {
    readonly stream: Duplex;
    readonly stdout: Writable;
    readonly stderr: Writable;
  }) => void;
}): DockerOutputObservation {
  const diagnostics = { text: '' };
  const pending = new Set<Promise<void>>();
  if (input.request.terminal.kind === 'tty') {
    attachTtyOutput({ stream: input.stream, request: input.request, diagnostics, pending });
  } else {
    input.demux({
      stream: input.stream,
      stdout: outputSink({ request: input.request, kind: 'stdout', diagnostics, pending }),
      stderr: outputSink({ request: input.request, kind: 'stderr', diagnostics, pending }),
    });
  }
  return {
    diagnostics,
    settled: async () => {
      while (pending.size > 0) {
        await Promise.all(pending);
      }
    },
  };
}
