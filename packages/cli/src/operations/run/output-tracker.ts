import { Writable } from 'node:stream';

/**
 * Remembers whether the child's output (either stream) ended mid-line, so the
 * Blackbox lines that follow on stderr start on a line of their own. The
 * child's bytes themselves are never changed.
 */
export class OutputTracker {
  #midLine = false;

  record(chunk: Uint8Array | string): void {
    if (chunk.length === 0) {
      return;
    }
    const last =
      typeof chunk === 'string' ? chunk.charCodeAt(chunk.length - 1) : chunk[chunk.length - 1];
    this.#midLine = last !== 0x0a;
  }

  /** A newline to write before Blackbox lines, or nothing. */
  separator(): string {
    return this.#midLine ? '\n' : '';
  }
}

/** A writable that records every chunk before forwarding it unchanged. */
export function trackedWritable(target: NodeJS.WritableStream, tracker: OutputTracker): Writable {
  return new Writable({
    write(chunk: Uint8Array | string, _encoding, callback) {
      tracker.record(chunk);
      target.write(chunk, (error) => {
        callback(error ?? null);
      });
    },
  });
}
