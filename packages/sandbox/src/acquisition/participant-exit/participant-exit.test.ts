import { expect, it } from 'vitest';
import { ParticipantExitedError, upUnlessParticipantExits } from './participant-exit.js';
import { container, noLogs, pendingUp, snapshots } from './participant-exit.fixture.js';

it('fails at once, naming the participant and its exit code, and takes the project down', async () => {
  // Benchmark F11: ts-price-service exited with code 0 while Java services were still starting.
  const pending = pendingUp();
  const states = snapshots(
    [container('ts-route-service', 'running'), container('ts-price-service', 'running')],
    [container('ts-route-service', 'running'), container('ts-price-service', 'exited', 0)],
  );
  const downs: string[] = [];
  const started = Date.now();
  const error: unknown = await upUnlessParticipantExits({
    up: pending.up,
    requiredServices: ['ts-route-service', 'ts-price-service'],
    inspect: states.inspect,
    readLogs: noLogs,
    down: () => {
      downs.push('down');
      pending.takenDown();
      return Promise.resolve();
    },
    intervalMs: 5,
  }).catch((caught: unknown) => caught);

  expect(error).toBeInstanceOf(ParticipantExitedError);
  expect(error).toMatchObject({
    service: 'ts-price-service',
    termination: { kind: 'exited', exitCode: 0 },
    message:
      'Participant "ts-price-service" exited during Sandbox startup with exit code 0; ' +
      'a selected participant must keep running',
  });
  expect(Date.now() - started).toBeLessThan(1_000);
  expect(downs).toEqual(['down', 'down']);
});

it('treats a dead container as an exit', async () => {
  const pending = pendingUp();
  await expect(
    upUnlessParticipantExits({
      up: pending.up,
      requiredServices: ['api'],
      inspect: snapshots([container('api', 'dead', 137)]).inspect,
      readLogs: noLogs,
      down: () => {
        pending.takenDown();
        return Promise.resolve();
      },
      intervalMs: 5,
    }),
  ).rejects.toThrow('Participant "api" exited during Sandbox startup with exit code 137');
});

it('ignores services that are not required and unavailable inventories', async () => {
  let finish: (value: string) => void = () => undefined;
  const up = new Promise<string>((resolve) => {
    finish = resolve;
  });
  const states = snapshots(new Error('Docker volume inventory was unavailable'), [
    container('migrations', 'exited', 0),
    container('api', 'running'),
  ]);
  let downs = 0;
  const result = upUnlessParticipantExits({
    up: () => up,
    requiredServices: ['api'],
    inspect: states.inspect,
    readLogs: noLogs,
    down: () => {
      downs++;
      return Promise.resolve();
    },
    intervalMs: 5,
  });
  while (states.calls() < 4) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  finish('started');

  await expect(result).resolves.toBe('started');
  expect(downs).toBe(0);
  const callsAfterStart = states.calls();
  await new Promise((resolve) => setTimeout(resolve, 30));
  expect(states.calls()).toBe(callsAfterStart);
});

it('reports both the exit and a failed cleanup', async () => {
  const pending = pendingUp();
  await expect(
    upUnlessParticipantExits({
      up: pending.up,
      requiredServices: ['api'],
      inspect: snapshots([container('api', 'exited', 1)]).inspect,
      readLogs: noLogs,
      down: () => Promise.reject(new Error('compose down failed')),
      intervalMs: 5,
    }),
  ).rejects.toMatchObject({
    name: 'AggregateError',
    errors: [{ name: 'ParticipantExitedError' }, { message: 'compose down failed' }],
  });
});
