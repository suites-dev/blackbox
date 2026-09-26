import { StringDecoder } from 'node:string_decoder';

import type { CapsuleExecutionInteraction, CapsuleInteractiveEvent } from '../types.js';
import { createStreamingValueRedactor, redactValues } from '../output/value-redaction.js';

type OutputEvent = Extract<CapsuleInteractiveEvent, { readonly kind: 'output' }>;

function streamRedactor(input: {
  readonly values: readonly string[];
  readonly stream: OutputEvent['stream'];
  readonly emit: (event: CapsuleInteractiveEvent) => void;
}) {
  const decoder = new StringDecoder('utf8');
  const redactor = createStreamingValueRedactor(input.values);
  function emit(text: string): void {
    if (text !== '') {
      input.emit({ kind: 'output', stream: input.stream, chunk: Buffer.from(text) });
    }
  }
  return {
    append: (chunk: Uint8Array) => {
      emit(redactor.append(decoder.write(Buffer.from(chunk))));
    },
    finish: () => {
      emit(redactor.append(decoder.end()));
      emit(redactor.finish());
    },
  };
}

export function createRedactedInteraction(input: {
  readonly interaction: CapsuleExecutionInteraction;
  readonly values: readonly string[];
}): { readonly interaction: CapsuleExecutionInteraction; readonly finish: () => void } {
  const { interaction, values } = input;
  if (interaction.kind === 'captured' || values.length === 0) {
    return { interaction, finish: () => undefined };
  }
  const streams = {
    stdout: streamRedactor({ values, stream: 'stdout', emit: interaction.onEvent }),
    stderr: streamRedactor({ values, stream: 'stderr', emit: interaction.onEvent }),
    terminal: streamRedactor({ values, stream: 'terminal', emit: interaction.onEvent }),
  };
  return {
    interaction: {
      ...interaction,
      onEvent(event) {
        if (event.kind === 'output') {
          streams[event.stream].append(event.chunk);
        } else if (event.result.kind === 'failed') {
          interaction.onEvent({ ...event, result: { ...event.result, error: {
            name: redactValues(event.result.error.name, values),
            message: redactValues(event.result.error.message, values),
          } } });
        } else {
          interaction.onEvent(event);
        }
      },
    },
    finish: () => {
      Object.values(streams).forEach((stream) => { stream.finish(); });
    },
  };
}
