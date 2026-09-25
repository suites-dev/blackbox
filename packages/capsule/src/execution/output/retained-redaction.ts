import type { RetainedOutput } from '../output-retention.js';
import { redactValues } from './value-redaction.js';

function redactEdge(input: {
  readonly text: string;
  readonly values: readonly string[];
  readonly edge: 'head' | 'tail';
}): string {
  let boundaryLength = 0;
  for (const value of input.values) {
    for (let length = Math.min(value.length, input.text.length); length > boundaryLength; length -= 1) {
      const matches = input.edge === 'head'
        ? input.text.endsWith(value.slice(0, length))
        : input.text.startsWith(value.slice(value.length - length));
      if (matches) {
        boundaryLength = length;
        break;
      }
    }
  }
  if (boundaryLength === 0) {
    return redactValues(input.text, input.values);
  }
  return input.edge === 'head'
    ? `${redactValues(input.text.slice(0, -boundaryLength), input.values)}[REDACTED]`
    : `[REDACTED]${redactValues(input.text.slice(boundaryLength), input.values)}`;
}

export function redactRetainedOutput(input: {
  readonly output: RetainedOutput;
  readonly values: readonly string[];
}): RetainedOutput {
  return input.output.kind === 'complete'
    ? { ...input.output, text: redactValues(input.output.text, input.values) }
    : { ...input.output,
        head: redactEdge({ text: input.output.head, values: input.values, edge: 'head' }),
        tail: redactEdge({ text: input.output.tail, values: input.values, edge: 'tail' }) };
}
