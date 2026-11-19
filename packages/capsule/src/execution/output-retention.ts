import { StringDecoder } from 'node:string_decoder';

import type { CapsuleOutputRetention } from '../model/execution/process-outcome.js';
import type { RetainedOutput } from './output/retained-output.js';
import { redactRetainedOutput } from './output/retained-redaction.js';

const RETAINED_BYTES = 1_048_576;
const RETAINED_EDGE_BYTES = RETAINED_BYTES / 2;

export interface OutputRetention {
  append(chunk: Buffer): void;
  finish(): RetainedOutput;
}

function trimTail(input: Buffer): Buffer {
  return input.length <= RETAINED_EDGE_BYTES
    ? input
    : input.subarray(input.length - RETAINED_EDGE_BYTES);
}

function tailText(input: Buffer): string {
  let start = 0;
  while (start < input.length && (input[start] & 0xc0) === 0x80) {
    start += 1;
  }
  return input.subarray(start).toString('utf8');
}

export function createOutputRetention(input: {
  readonly secrets: readonly string[];
} = { secrets: [] }): OutputRetention {
  const complete: Buffer[] = [];
  let completeBytes = 0;
  let head = Buffer.alloc(0);
  let tail = Buffer.alloc(0);
  let originalBytes = 0;
  let truncated = false;

  return {
    append(chunk) {
      originalBytes += chunk.length;
      if (!truncated && completeBytes + chunk.length <= RETAINED_BYTES) {
        complete.push(chunk);
        completeBytes += chunk.length;
        return;
      }
      if (!truncated) {
        const previous = Buffer.concat(complete, completeBytes);
        const overflow = Buffer.concat([previous, chunk]);
        head = overflow.subarray(0, RETAINED_EDGE_BYTES);
        tail = trimTail(overflow);
        truncated = true;
        return;
      }
      tail = trimTail(Buffer.concat([tail, chunk]));
    },
    finish() {
      if (!truncated) {
        return redactRetainedOutput({ values: input.secrets, output: {
          kind: 'complete',
          text: Buffer.concat(complete, completeBytes).toString('utf8'),
          originalBytes,
        } });
      }
      const retainedBytes = head.length + tail.length;
      return redactRetainedOutput({ values: input.secrets, output: {
        kind: 'truncated',
        head: new StringDecoder('utf8').write(head),
        tail: tailText(tail),
        originalBytes,
        retainedBytes,
        omittedBytes: originalBytes - retainedBytes,
      } });
    },
  };
}

export function retainedOutputText(output: RetainedOutput): string {
  return output.kind === 'complete' ? output.text : `${output.head}${output.tail}`;
}

// The capture seam is available to the manager before JSON serialization. Retention byte
// counts alone cannot reconstruct it after UTF-8 decoding and driver-declared redaction.
const tailOffset = Symbol('retained tail offset');

export function retainedTextForRedaction(text: string, retention: CapsuleOutputRetention): string {
  if (!(tailOffset in retention) || typeof retention[tailOffset] !== 'number') {
    return text;
  }
  const offset = retention[tailOffset];
  // The missing middle may contain a sensitive field name. Mask the partial tail line
  // and its folded continuations, then resume on the first independent line.
  const tail = text.slice(offset).replace(/^[^\r\n]*(?:\r?\n[\t ]+[^\r\n]*)*/u, '[REDACTED]');
  return `${text.slice(0, offset)}\n${tail}`;
}

export function retainedOutputMetadata(output: RetainedOutput) {
  return output.kind === 'complete'
    ? { kind: 'complete' as const, originalBytes: output.originalBytes }
    : {
        kind: 'truncated' as const,
        [tailOffset]: output.head.length,
        originalBytes: output.originalBytes,
        retainedBytes: output.retainedBytes,
        omittedBytes: output.omittedBytes,
        retained: 'head-and-tail' as const,
      };
}
