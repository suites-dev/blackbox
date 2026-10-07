import { expect, it } from 'vitest';

import { participantExec } from './exec.js';
import type { RunningBlackboxAttempt } from '../runtime/acquisition.js';
import type { ParticipantActivityInput } from './participant-activity.js';

function attempt(runs: ParticipantActivityInput[], exitCode: number): RunningBlackboxAttempt {
  return {
    sandbox: {} as RunningBlackboxAttempt['sandbox'],
    telemetry: {} as RunningBlackboxAttempt['telemetry'],
    effects: { sessionId: 'session', executionId: 'execution' },
    stop: () => Promise.resolve(),
    runActivity: (activity) => {
      runs.push(activity);
      return Promise.resolve({
        exitCode,
        stdout: 'ok',
        stderr: '',
        startedAt: '2026-10-02T00:00:00.000Z',
        completedAt: '2026-10-02T00:00:01.000Z',
        rootSpan: { kind: 'root-span-exported' },
      });
    },
  };
}

function progress(events: string[]) {
  return {
    protect: () => undefined,
    identify: () => undefined,
    emit: (phase: string, status: string, detail: string) => {
      events.push(`${phase}:${status}:${detail}`);
    },
  };
}

it('gives every command its own activity and trace, and records it without its arguments', async () => {
  const runs: ParticipantActivityInput[] = [];
  const events: string[] = [];
  const { exec } = participantExec(attempt(runs, 0), progress(events));
  const first = await exec('ts-auth-service', ['seed', '--password', 'hunter2']);
  const second = await exec('ts-auth-service', ['seed']);
  expect(first).toMatchObject({
    purpose: 'setup',
    participant: 'ts-auth-service',
    argv: ['seed', '--password', 'hunter2'],
    exitCode: 0,
    stdout: 'ok',
    rootSpan: { kind: 'root-span-exported' },
  });
  expect(Object.isFrozen(first)).toBe(true);
  expect(first.traceparent).toBe(runs[0].traceparent);
  expect(first.traceparent.split('-')[1]).toBe(first.traceId);
  expect(first.activityId).toBe(runs[0].activityId);
  expect(second.traceId).not.toBe(first.traceId);
  expect(second.activityId).not.toBe(first.activityId);
  expect(events[0]).toBe(
    `activity:started:${first.activityId}; setup in ts-auth-service: seed with 2 arguments; ` +
      `trace ${first.traceId}`,
  );
  expect(events[1]).toBe(`activity:completed:${first.activityId}; exit 0; root-span-exported`);
  expect(events.join('\n')).not.toContain('hunter2');
});

it('records a failed command as a failed activity and still returns its outcome', async () => {
  const events: string[] = [];
  const result = await participantExec(attempt([], 7), progress(events)).exec('db', ['false']);
  expect(result.exitCode).toBe(7);
  expect(events[1]).toBe(`activity:failed:${result.activityId}; exit 7; root-span-exported`);
});

it('expires retained exec handles without starting or recording another activity', async () => {
  const runs: ParticipantActivityInput[] = [];
  const events: string[] = [];
  const commands = participantExec(attempt(runs, 0), progress(events));
  const retainedExec = commands.exec;
  await retainedExec('db', ['seed']);
  commands.close();
  commands.close();

  await expect(retainedExec('db', ['seed'])).rejects.toThrow(
    'This Blackbox attempt has expired. Activity execution is no longer available.',
  );
  expect(runs).toHaveLength(1);
  expect(events).toHaveLength(2);
});
