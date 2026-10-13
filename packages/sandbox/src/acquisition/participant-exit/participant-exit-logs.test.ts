import { expect, it } from 'vitest';
import { ParticipantExitedError, upUnlessParticipantExits } from './participant-exit.js';
import { container, noLogs, pendingUp, snapshots } from './participant-exit.fixture.js';

it('reads the logs of every exited container before the project is taken down', async () => {
  // Issue #190: RabbitMQ exited with code 0 during startup and cleanup removed its logs.
  const pending = pendingUp();
  const steps: string[] = [];
  const error: unknown = await upUnlessParticipantExits({
    up: pending.up,
    requiredServices: ['queue', 'api'],
    inspect: snapshots([
      container('migrations', 'exited', 0),
      container('api', 'running'),
      container('queue', 'exited', 0),
    ]).inspect,
    readLogs: (containers) => {
      steps.push(`logs ${containers.map(({ service }) => service).join(',')}`);
      return Promise.resolve(
        containers.map((exited) => ({
          service: exited.service,
          termination: exited.termination,
          logs: {
            kind: 'read' as const,
            lines: [`${exited.service} line 1`, `${exited.service} line 2`],
          },
        })),
      );
    },
    down: () => {
      steps.push('down');
      pending.takenDown();
      return Promise.resolve();
    },
    intervalMs: 5,
  }).catch((caught: unknown) => caught);

  expect(steps).toEqual(['logs queue,migrations', 'down', 'down']);
  expect(error).toBeInstanceOf(ParticipantExitedError);
  expect((error as ParticipantExitedError).message).toBe(
    'Participant "queue" exited during Sandbox startup with exit code 0; ' +
      'a selected participant must keep running\n' +
      'Last log lines of "queue" (exit code 0):\n' +
      '  queue line 1\n' +
      '  queue line 2\n' +
      'Last log lines of "migrations" (exit code 0):\n' +
      '  migrations line 1\n' +
      '  migrations line 2',
  );
  expect((error as ParticipantExitedError).logTails.map(({ service }) => service)).toEqual([
    'queue',
    'migrations',
  ]);
});

it('still names the exited participant when its logs cannot be read', async () => {
  const pending = pendingUp();
  await expect(
    upUnlessParticipantExits({
      up: pending.up,
      requiredServices: ['queue'],
      inspect: snapshots([container('queue', 'exited', 0)]).inspect,
      readLogs: () => Promise.reject(new Error('Docker log request failed')),
      down: () => {
        pending.takenDown();
        return Promise.resolve();
      },
      intervalMs: 5,
    }),
  ).rejects.toMatchObject({
    name: 'ParticipantExitedError',
    message:
      'Participant "queue" exited during Sandbox startup with exit code 0; ' +
      'a selected participant must keep running',
    logTails: [],
  });
});

it('reports the exit with its logs when Compose fails on it before the watcher sees it', async () => {
  // Compose waits on `depends_on: service_healthy` and fails with its own error
  // when the dependency exits; the exit and its logs are still the reported cause.
  let upFailed = false;
  const composeError = new Error(
    'dependency failed to start: container project-queue-1 exited (0)',
  );
  const steps: string[] = [];
  const error: unknown = await upUnlessParticipantExits({
    up: async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      upFailed = true;
      throw composeError;
    },
    requiredServices: ['queue'],
    inspect: () =>
      Promise.resolve({
        containers: [container('queue', upFailed ? 'exited' : 'running', 0)],
        resources: [],
      }),
    readLogs: (containers) => {
      steps.push('logs');
      return Promise.resolve(
        containers.map((exited) => ({
          service: exited.service,
          termination: exited.termination,
          logs: { kind: 'read' as const, lines: ['BOOT FAILED'] },
        })),
      );
    },
    down: () => {
      steps.push('down');
      return Promise.resolve();
    },
    intervalMs: 5,
  }).catch((caught: unknown) => caught);

  expect(error).toBeInstanceOf(ParticipantExitedError);
  expect(error).toMatchObject({
    service: 'queue',
    cause: composeError,
    message: expect.stringContaining('Last log lines of "queue" (exit code 0):\n  BOOT FAILED'),
  });
  expect(steps).toEqual(['logs', 'down', 'down']);
});

it('rethrows a failed up() unchanged when no required participant exited', async () => {
  const composeError = new Error('pull access denied for missing-image');
  let downs = 0;
  await expect(
    upUnlessParticipantExits({
      up: () => Promise.reject(composeError),
      requiredServices: ['api'],
      inspect: snapshots([container('api', 'created')]).inspect,
      readLogs: noLogs,
      down: () => {
        downs++;
        return Promise.resolve();
      },
      intervalMs: 5,
    }),
  ).rejects.toBe(composeError);
  expect(downs).toBe(0);
});
