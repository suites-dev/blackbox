import { stripVTControlCharacters } from 'node:util';
import type { ComposeServiceObservation } from '../observation.js';

/** Lines kept per exited participant: enough for a shutdown sequence and the reason before it. */
export const PARTICIPANT_LOG_TAIL_LINES = 50;
const MAX_LINE_LENGTH = 500;

/** The last lines an exited participant wrote, read before Compose removes its container. */
export interface ParticipantLogTail {
  readonly service: string;
  readonly termination: ComposeServiceObservation['termination'];
  readonly logs:
    | { readonly kind: 'read'; readonly lines: readonly string[] }
    | { readonly kind: 'unavailable'; readonly reason: string };
}

export interface ParticipantLogClient {
  getContainer(id: string): {
    inspect(options: {
      readonly abortSignal: AbortSignal;
    }): Promise<{ readonly Config: { readonly Tty: boolean } }>;
    logs(options: {
      readonly stdout: true;
      readonly stderr: true;
      readonly follow: false;
      readonly tail: number;
      readonly abortSignal: AbortSignal;
    }): Promise<Buffer>;
  };
}

/**
 * Docker multiplexes stdout and stderr of a container without a TTY into
 * frames: a stream byte, three zero bytes, a big-endian payload size, then
 * the payload. Interleaved output is kept in the order Docker sent it.
 */
export function demultiplexDockerLogs(output: Buffer): string {
  const payloads: Buffer[] = [];
  let offset = 0;
  while (offset + 8 <= output.length) {
    const size = output.readUInt32BE(offset + 4);
    payloads.push(output.subarray(offset + 8, offset + 8 + size));
    offset += 8 + size;
  }
  return Buffer.concat(payloads).toString('utf8');
}

/** Container output is untrusted: keep its text, never its escape sequences or control characters. */
function plainText(line: string): string {
  let result = '';
  for (const character of stripVTControlCharacters(line)) {
    const code = character.codePointAt(0) ?? 0;
    result += character !== '\t' && (code < 32 || (code >= 127 && code <= 159)) ? ' ' : character;
  }
  return result;
}

function tailLines(text: string): readonly string[] {
  const lines = text.replace(/\r\n/gu, '\n').split('\n');
  if (lines.at(-1) === '') {
    lines.pop();
  }
  return lines
    .slice(-PARTICIPANT_LOG_TAIL_LINES)
    .map(plainText)
    .map((line) =>
      line.length > MAX_LINE_LENGTH ? `${line.slice(0, MAX_LINE_LENGTH)} [truncated]` : line,
    );
}

async function readLogLines(input: {
  readonly docker: ParticipantLogClient;
  readonly containerId: string;
  readonly signal: AbortSignal;
}): Promise<readonly string[]> {
  const container = input.docker.getContainer(input.containerId);
  const [inspected, output] = await Promise.all([
    container.inspect({ abortSignal: input.signal }),
    container.logs({
      stdout: true,
      stderr: true,
      follow: false,
      tail: PARTICIPANT_LOG_TAIL_LINES,
      abortSignal: input.signal,
    }),
  ]);
  return tailLines(inspected.Config.Tty ? output.toString('utf8') : demultiplexDockerLogs(output));
}

/** Reads each container's log tail; a container whose logs cannot be read says why instead. */
export async function readParticipantLogTails(input: {
  readonly docker: ParticipantLogClient;
  readonly containers: readonly ComposeServiceObservation[];
  readonly timeoutMs: number;
}): Promise<readonly ParticipantLogTail[]> {
  const signal = AbortSignal.timeout(input.timeoutMs);
  return Promise.all(
    input.containers.map(async (container): Promise<ParticipantLogTail> => {
      try {
        const lines = await readLogLines({
          docker: input.docker,
          containerId: container.containerId,
          signal,
        });
        return {
          service: container.service,
          termination: container.termination,
          logs: { kind: 'read', lines },
        };
      } catch (error) {
        return {
          service: container.service,
          termination: container.termination,
          logs: {
            kind: 'unavailable',
            reason: error instanceof Error ? error.message : String(error),
          },
        };
      }
    }),
  );
}

function exitText(termination: ParticipantLogTail['termination']): string {
  return termination.kind === 'exited' ? `exit code ${termination.exitCode}` : 'no exit code';
}

/** Renders log tails for an error message, which the start-failure record and `up` both keep. */
export function formatParticipantLogTails(tails: readonly ParticipantLogTail[]): string {
  return tails
    .map((tail) => {
      const heading = `Last log lines of ${JSON.stringify(tail.service)} (${exitText(tail.termination)}):`;
      if (tail.logs.kind === 'unavailable') {
        return `${heading}\n  (logs unavailable: ${tail.logs.reason})`;
      }
      if (tail.logs.lines.length === 0) {
        return `${heading}\n  (no output)`;
      }
      return [heading, ...tail.logs.lines.map((line) => `  ${line}`)].join('\n');
    })
    .join('\n');
}
