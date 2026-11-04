import { expect, it } from 'vitest';
import type { ComposeServiceObservation } from '../observation.js';
import {
  demultiplexDockerLogs,
  formatParticipantLogTails,
  PARTICIPANT_LOG_TAIL_LINES,
  readParticipantLogTails,
  type ParticipantLogClient,
} from './participant-logs.js';

function frame(stream: 1 | 2, text: string): Buffer {
  const payload = Buffer.from(text, 'utf8');
  const header = Buffer.alloc(8);
  header.writeUInt8(stream, 0);
  header.writeUInt32BE(payload.length, 4);
  return Buffer.concat([header, payload]);
}

function exited(service: string, exitCode: number): ComposeServiceObservation {
  return {
    service,
    containerId: `${service}-id`,
    containerName: `project-${service}-1`,
    state: 'exited',
    health: 'unhealthy',
    termination: { kind: 'exited', exitCode },
  };
}

function client(
  containers: ReadonlyMap<string, { readonly tty: boolean; readonly output: Buffer | Error }>,
): ParticipantLogClient & { readonly requests: unknown[] } {
  const requests: unknown[] = [];
  const known = (id: string) => {
    const found = containers.get(id);
    if (found === undefined) {
      throw new Error(`no such container: ${id}`);
    }
    return found;
  };
  return {
    requests,
    getContainer: (id) => ({
      inspect: () => Promise.resolve({ Config: { Tty: known(id).tty } }),
      logs: (options) => {
        requests.push({ id, tail: options.tail, follow: options.follow });
        const { output } = known(id);
        return output instanceof Error ? Promise.reject(output) : Promise.resolve(output);
      },
    }),
  };
}

it('keeps stdout and stderr frames in the order Docker sent them', () => {
  const output = Buffer.concat([
    frame(1, 'starting\n'),
    frame(2, 'warning: low disk\n'),
    frame(1, 'stopped\n'),
  ]);

  expect(demultiplexDockerLogs(output)).toBe('starting\nwarning: low disk\nstopped\n');
});

it('reads the tail of each exited container as plain text, demultiplexed unless it has a TTY', async () => {
  const docker = client(
    new Map([
      [
        'queue-id',
        {
          tty: false,
          output: Buffer.concat([
            frame(1, 'booting\n'),
            frame(2, 'RabbitMQ is asked to stop...\n'),
          ]),
        },
      ],
      [
        'console-id',
        {
          tty: true,
          output: Buffer.from('\u001b[38;5;87mraw tty line\u001b[0m\r\nlast\u0007 line\r\n'),
        },
      ],
    ]),
  );

  const tails = await readParticipantLogTails({
    docker,
    containers: [exited('queue', 0), exited('console', 1)],
    timeoutMs: 1_000,
  });

  expect(tails).toEqual([
    {
      service: 'queue',
      termination: { kind: 'exited', exitCode: 0 },
      logs: { kind: 'read', lines: ['booting', 'RabbitMQ is asked to stop...'] },
    },
    {
      service: 'console',
      termination: { kind: 'exited', exitCode: 1 },
      // Escape sequences and control characters from the container never reach records or terminals.
      logs: { kind: 'read', lines: ['raw tty line', 'last  line'] },
    },
  ]);
  expect(docker.requests).toEqual([
    { id: 'queue-id', tail: PARTICIPANT_LOG_TAIL_LINES, follow: false },
    { id: 'console-id', tail: PARTICIPANT_LOG_TAIL_LINES, follow: false },
  ]);
});

it('bounds what it keeps and says why logs it could not read are missing', async () => {
  const many = Array.from(
    { length: PARTICIPANT_LOG_TAIL_LINES + 10 },
    (_, index) => `line ${index}`,
  );
  const docker = client(
    new Map([
      ['chatty-id', { tty: true, output: Buffer.from(`${many.join('\n')}\n${'x'.repeat(600)}\n`) }],
      ['gone-id', { tty: false, output: new Error('No such container: gone-id') }],
    ]),
  );

  const tails = await readParticipantLogTails({
    docker,
    containers: [exited('chatty', 0), exited('gone', 137)],
    timeoutMs: 1_000,
  });

  expect(tails).toEqual([
    {
      service: 'chatty',
      termination: { kind: 'exited', exitCode: 0 },
      logs: {
        kind: 'read',
        lines: [...many.slice(-(PARTICIPANT_LOG_TAIL_LINES - 1)), `${'x'.repeat(500)} [truncated]`],
      },
    },
    {
      service: 'gone',
      termination: { kind: 'exited', exitCode: 137 },
      logs: { kind: 'unavailable', reason: 'No such container: gone-id' },
    },
  ]);
  expect(formatParticipantLogTails(tails.slice(1))).toBe(
    'Last log lines of "gone" (exit code 137):\n  (logs unavailable: No such container: gone-id)',
  );
});
