import type { ComposeObservationSnapshot, ComposeServiceObservation } from '../observation.js';
import type { ParticipantLogTail } from './participant-logs.js';

export const noLogs = (): Promise<readonly ParticipantLogTail[]> => Promise.resolve([]);

export function container(
  service: string,
  state: ComposeServiceObservation['state'],
  exitCode = 0,
): ComposeServiceObservation {
  return {
    service,
    containerId: `${service}-id`,
    containerName: `project-${service}-1`,
    state,
    health: 'not-configured',
    termination:
      state === 'exited' || state === 'dead' ? { kind: 'exited', exitCode } : { kind: 'none' },
  };
}

export function snapshots(...sequence: readonly (readonly ComposeServiceObservation[] | Error)[]) {
  let index = 0;
  let calls = 0;
  return {
    calls: () => calls,
    inspect: (): Promise<ComposeObservationSnapshot> => {
      calls++;
      const next = sequence[Math.min(index++, sequence.length - 1)];
      return next instanceof Error
        ? Promise.reject(next)
        : Promise.resolve({ containers: next, resources: [] });
    },
  };
}

/** An `up()` that, like Testcontainers, only fails once its containers are taken down. */
export function pendingUp() {
  let fail: (error: Error) => void = () => undefined;
  const up = new Promise<string>((_resolve, reject) => {
    fail = reject;
  });
  return {
    up: () => up,
    takenDown: () => {
      fail(new Error('container removed while waiting'));
    },
  };
}
