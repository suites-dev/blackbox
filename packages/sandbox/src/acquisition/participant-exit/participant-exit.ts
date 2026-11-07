import { setTimeout as delay } from 'node:timers/promises';
import type { ComposeObservationSnapshot, ComposeServiceObservation } from '../observation.js';
import { formatParticipantLogTails, type ParticipantLogTail } from './participant-logs.js';

/**
 * A selected participant stopped while the Sandbox was still starting. The
 * message carries the last log lines of every exited container, because
 * cleanup removes the containers and their logs with them.
 */
export class ParticipantExitedError extends Error {
  readonly service: string;
  readonly termination: ComposeServiceObservation['termination'];
  readonly logTails: readonly ParticipantLogTail[];

  constructor(
    container: ComposeServiceObservation,
    logTails: readonly ParticipantLogTail[] = [],
    cause?: unknown,
  ) {
    super(
      `Participant ${JSON.stringify(container.service)} exited during Sandbox startup` +
        (container.termination.kind === 'exited'
          ? ` with exit code ${container.termination.exitCode}`
          : '') +
        '; a selected participant must keep running' +
        (logTails.length === 0 ? '' : `\n${formatParticipantLogTails(logTails)}`),
      cause === undefined ? undefined : { cause },
    );
    this.name = 'ParticipantExitedError';
    this.service = container.service;
    this.termination = container.termination;
    this.logTails = logTails;
  }
}

/** The required participant that exited, and every container of the project that had exited by then. */
export interface ParticipantExit {
  readonly participant: ComposeServiceObservation;
  readonly exited: readonly ComposeServiceObservation[];
}

function hasExited(container: ComposeServiceObservation): boolean {
  return container.state === 'exited' || container.state === 'dead';
}

function participantExitIn(input: {
  readonly snapshot: ComposeObservationSnapshot;
  readonly services: ReadonlySet<string>;
}): ParticipantExit | undefined {
  const participant = input.snapshot.containers.find(
    (candidate) => input.services.has(candidate.service) && hasExited(candidate),
  );
  return participant === undefined
    ? undefined
    : {
        participant,
        exited: [
          participant,
          ...input.snapshot.containers.filter(
            (candidate) => candidate !== participant && hasExited(candidate),
          ),
        ],
      };
}

/** One last look after `up()` failed: Compose may report a dependency's exit before the watcher sees it. */
async function exitAfterFailedUp(input: {
  readonly services: readonly string[];
  readonly inspect: (input: {
    readonly signal: AbortSignal;
  }) => Promise<ComposeObservationSnapshot>;
}): Promise<ParticipantExit | undefined> {
  try {
    const snapshot = await input.inspect({ signal: AbortSignal.timeout(2_000) });
    return participantExitIn({ snapshot, services: new Set(input.services) });
  } catch {
    return undefined;
  }
}

/**
 * Polls the Compose project while it starts. Testcontainers only waits for
 * running containers, so a selected participant that exits is otherwise
 * noticed after every other participant is ready or the startup timeout ends.
 * `exited` resolves with the first exit seen and never rejects.
 */
export function watchParticipantExits(input: {
  readonly services: readonly string[];
  readonly inspect: (input: {
    readonly signal: AbortSignal;
  }) => Promise<ComposeObservationSnapshot>;
  readonly intervalMs: number;
}): {
  readonly exited: Promise<ParticipantExit>;
  readonly stop: () => Promise<void>;
} {
  const controller = new AbortController();
  const services = new Set(input.services);
  let report: (exit: ParticipantExit) => void = () => undefined;
  const exited = new Promise<ParticipantExit>((resolve) => {
    report = resolve;
  });
  const exitIn = async (): Promise<ParticipantExit | undefined> => {
    try {
      const snapshot = await input.inspect({
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(2_000)]),
      });
      return participantExitIn({ snapshot, services });
    } catch {
      // An unavailable Docker inventory is not evidence that a participant exited.
      return undefined;
    }
  };
  const running = (async () => {
    while (!controller.signal.aborted) {
      const exit = await exitIn();
      if (exit !== undefined) {
        report(exit);
        return;
      }
      await delay(input.intervalMs, undefined, { signal: controller.signal }).catch(
        () => undefined,
      );
    }
  })();
  return {
    exited,
    stop: async () => {
      controller.abort();
      await running;
    },
  };
}

async function exitError(input: {
  readonly exit: ParticipantExit;
  readonly readLogs: (
    containers: readonly ComposeServiceObservation[],
  ) => Promise<readonly ParticipantLogTail[]>;
  /** The `up()` failure that reported the exit first, if any. */
  readonly cause: unknown;
}): Promise<ParticipantExitedError> {
  let logTails: readonly ParticipantLogTail[] = [];
  try {
    logTails = await input.readLogs(input.exit.exited);
  } catch {
    // Missing logs cannot hide which participant exited.
  }
  return new ParticipantExitedError(input.exit.participant, logTails, input.cause);
}

/**
 * Runs Compose `up()` but fails as soon as a required service exits.
 *
 * `up()` cannot be cancelled, so an exit takes the project down, lets `up()`
 * fail on the removed containers, and takes down anything it created meanwhile.
 * When `up()` fails first because Compose saw the exit, the exit is still the
 * reported cause. The exited containers' logs are read before taking down,
 * which removes them.
 */
export async function upUnlessParticipantExits<Started>(input: {
  readonly up: () => Promise<Started>;
  readonly requiredServices: readonly string[];
  readonly inspect: (input: {
    readonly signal: AbortSignal;
  }) => Promise<ComposeObservationSnapshot>;
  readonly readLogs: (
    containers: readonly ComposeServiceObservation[],
  ) => Promise<readonly ParticipantLogTail[]>;
  readonly down: () => Promise<void>;
  readonly intervalMs: number;
}): Promise<Started> {
  const exits = watchParticipantExits({
    services: input.requiredServices,
    inspect: input.inspect,
    intervalMs: input.intervalMs,
  });
  const starting = input.up();
  const outcome = await Promise.race([
    starting.then(
      (started) => ({ kind: 'started' as const, started }),
      (error: unknown) => ({ kind: 'failed' as const, error }),
    ),
    exits.exited.then((exit) => ({ kind: 'exited' as const, exit })),
  ]).finally(() => exits.stop());
  if (outcome.kind === 'started') {
    return outcome.started;
  }
  let error: ParticipantExitedError;
  if (outcome.kind === 'failed') {
    const exit = await exitAfterFailedUp({
      services: input.requiredServices,
      inspect: input.inspect,
    });
    if (exit === undefined) {
      throw outcome.error;
    }
    error = await exitError({ exit, readLogs: input.readLogs, cause: outcome.error });
  } else {
    error = await exitError({ exit: outcome.exit, readLogs: input.readLogs, cause: undefined });
  }
  try {
    await input.down();
    await starting.then(
      () => undefined,
      () => undefined,
    );
    await input.down();
  } catch (cleanupError) {
    throw new AggregateError(
      [error, cleanupError],
      'A participant exited during startup and Compose cleanup also failed',
    );
  }
  throw error;
}
