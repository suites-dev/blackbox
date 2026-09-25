import { StringDecoder } from 'node:string_decoder';

import { redactRetainedOutput } from './output/retained-redaction.js';

const RETAINED_BYTES = 1_048_576;
const RETAINED_EDGE_BYTES = RETAINED_BYTES / 2;

export type RetainedOutput =
  | {
      readonly kind: 'complete';
      readonly text: string;
      readonly originalBytes: number;
    }
  | {
      readonly kind: 'truncated';
      readonly head: string;
      readonly tail: string;
      readonly originalBytes: number;
      readonly retainedBytes: number;
      readonly omittedBytes: number;
    };

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

export function retainedOutputMetadata(output: RetainedOutput) {
  return output.kind === 'complete'
    ? { kind: 'complete' as const, originalBytes: output.originalBytes }
    : {
        kind: 'truncated' as const,
        originalBytes: output.originalBytes,
        retainedBytes: output.retainedBytes,
        omittedBytes: output.omittedBytes,
        retained: 'head-and-tail' as const,
      };
}
