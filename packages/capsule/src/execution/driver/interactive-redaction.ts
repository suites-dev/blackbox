import { StringDecoder } from 'node:string_decoder';

import type { CapsuleExecutionInteraction, CapsuleInteractiveEvent } from '../types.js';
import { createStreamingValueRedactor, redactValues } from '../output/value-redaction.js';

type OutputEvent = Extract<CapsuleInteractiveEvent, { readonly kind: 'output' }>;

function streamRedactor(input: {
  readonly values: readonly string[];
  readonly stream: OutputEvent['stream'];
  readonly emit: (event: CapsuleInteractiveEvent) => Promise<void>;
}) {
  const decoder = new StringDecoder('utf8');
  const redactor = createStreamingValueRedactor(input.values);
  async function emit(text: string): Promise<void> {
    if (text !== '') {
      await input.emit({ kind: 'output', stream: input.stream, chunk: Buffer.from(text) });
    }
  }
  return {
    append: async (chunk: Uint8Array) => {
      await emit(redactor.append(decoder.write(Buffer.from(chunk))));
    },
    finish: async () => {
      await emit(redactor.append(decoder.end()));
      await emit(redactor.finish());
    },
  };
}

export function createRedactedInteraction(input: {
  readonly interaction: CapsuleExecutionInteraction;
  readonly values: readonly string[];
}): { readonly interaction: CapsuleExecutionInteraction; readonly finish: () => Promise<void> } {
  const { interaction, values } = input;
  if (interaction.kind === 'captured' || values.length === 0) {
    return { interaction, finish: () => Promise.resolve() };
  }
  const streams = {
    stdout: streamRedactor({ values, stream: 'stdout', emit: interaction.onEvent }),
    stderr: streamRedactor({ values, stream: 'stderr', emit: interaction.onEvent }),
    terminal: streamRedactor({ values, stream: 'terminal', emit: interaction.onEvent }),
  };
  return {
    interaction: {
      ...interaction,
      async onEvent(event) {
        if (event.kind === 'output') {
          await streams[event.stream].append(event.chunk);
        } else if (event.result.kind === 'failed') {
          await interaction.onEvent({
            ...event,
            result: {
              ...event.result,
              error: {
                name: redactValues(event.result.error.name, values),
                message: redactValues(event.result.error.message, values),
              },
            },
          });
        } else {
          await interaction.onEvent(event);
        }
      },
    },
    finish: async () => {
      await Promise.all(
        Object.values(streams).map(async (stream) => {
          await stream.finish();
        }),
      );
    },
  };
}
