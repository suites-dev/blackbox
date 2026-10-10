import { setTimeout as delay } from 'node:timers/promises';
import type { ComposeObservationSnapshot, ComposeServiceObservation } from '../observation.js';

/** A selected participant stopped while the Sandbox was still starting. */
export class ParticipantExitedError extends Error {
  readonly service: string;
  readonly termination: ComposeServiceObservation['termination'];

  constructor(container: ComposeServiceObservation) {
    super(
      `Participant ${JSON.stringify(container.service)} exited during Sandbox startup` +
        (container.termination.kind === 'exited'
          ? ` with exit code ${container.termination.exitCode}`
          : '') +
        '; a selected participant must keep running',
    );
    this.name = 'ParticipantExitedError';
    this.service = container.service;
    this.termination = container.termination;
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
  readonly exited: Promise<ParticipantExitedError>;
  readonly stop: () => Promise<void>;
} {
  const controller = new AbortController();
  const services = new Set(input.services);
  let report: (error: ParticipantExitedError) => void = () => undefined;
  const exited = new Promise<ParticipantExitedError>((resolve) => {
    report = resolve;
  });
  const exitIn = async (): Promise<ParticipantExitedError | undefined> => {
    try {
      const snapshot = await input.inspect({
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(2_000)]),
      });
      const container = snapshot.containers.find(
        (candidate) =>
          services.has(candidate.service) &&
          (candidate.state === 'exited' || candidate.state === 'dead'),
      );
      return container === undefined ? undefined : new ParticipantExitedError(container);
    } catch {
      // An unavailable Docker inventory is not evidence that a participant exited.
      return undefined;
    }
  };
  const running = (async () => {
    while (!controller.signal.aborted) {
      const error = await exitIn();
      if (error !== undefined) {
        report(error);
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

/**
 * Runs Compose `up()` but fails as soon as a required service exits.
 *
 * `up()` cannot be cancelled, so an exit takes the project down, lets `up()`
 * fail on the removed containers, and takes down anything it created meanwhile.
 */
export async function upUnlessParticipantExits<Started>(input: {
  readonly up: () => Promise<Started>;
  readonly requiredServices: readonly string[];
  readonly inspect: (input: {
    readonly signal: AbortSignal;
  }) => Promise<ComposeObservationSnapshot>;
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
    starting.then((started) => ({ kind: 'started' as const, started })),
    exits.exited.then((error) => ({ kind: 'exited' as const, error })),
  ]).finally(() => exits.stop());
  if (outcome.kind === 'started') {
    return outcome.started;
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
      [outcome.error, cleanupError],
      'A participant exited during startup and Compose cleanup also failed',
    );
  }
  throw outcome.error;
}
