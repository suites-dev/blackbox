import type {
  SandboxTelemetryEnabledInput,
  SandboxTelemetryEndpoints,
  SandboxTelemetryStatus,
} from '../types.js';
import {
  COLLECTOR_ACTIVATION_PATH,
  COLLECTOR_STATUS_PATH,
  COLLECTOR_TRACES_PATH,
} from './environment.js';

interface StoppableContainer {
  getHost(): string;
  getMappedPort(port: number): number;
  stop(input: {
    readonly timeout: number;
    readonly remove: boolean;
    readonly removeVolumes: boolean;
  }): Promise<unknown>;
}

interface StartedComposeAccess {
  getContainer(name: string): StoppableContainer;
}

function errorDetails(cause: unknown): { readonly name: string; readonly message: string } {
  return cause instanceof Error
    ? { name: cause.name, message: cause.message }
    : { name: 'Error', message: String(cause) };
}

function endpoints(baseUrl: string): SandboxTelemetryEndpoints {
  return Object.freeze({
    baseUrl,
    tracesUrl: `${baseUrl}${COLLECTOR_TRACES_PATH}`,
    activationUrl: `${baseUrl}${COLLECTOR_ACTIVATION_PATH}`,
    readUrl: `${baseUrl}${COLLECTOR_STATUS_PATH}`,
  });
}

export function composeTelemetryController(input: {
  readonly started: StartedComposeAccess;
  readonly telemetry: SandboxTelemetryEnabledInput;
}): {
  readonly inspect: () => Promise<SandboxTelemetryStatus>;
  readonly prepareStop: (request: { readonly timeoutMs: number }) => Promise<void>;
} {
  const collector = input.started.getContainer(`${input.telemetry.collector.service}-1`);
  const baseUrl = `http://${collector.getHost()}:${collector.getMappedPort(
    input.telemetry.collector.containerPort,
  )}`;
  const resolvedEndpoints = endpoints(baseUrl);
  return {
    async inspect(): Promise<SandboxTelemetryStatus> {
      try {
        const response = await fetch(resolvedEndpoints.readUrl, {
          headers: {
            Authorization: `Bearer ${input.telemetry.authorization.controlToken}`,
          },
          signal: AbortSignal.timeout(2_000),
        });
        if (!response.ok) {
          throw new Error(`Collector status returned HTTP ${response.status}`);
        }
        return { kind: 'available', endpoints: resolvedEndpoints };
      } catch (cause) {
        return {
          kind: 'unavailable',
          endpoints: resolvedEndpoints,
          error: errorDetails(cause),
        };
      }
    },
    async prepareStop(request): Promise<void> {
      const { participantMs, collectorMs } = stopGrace(request.timeoutMs);
      const errors: unknown[] = [];
      const participantStops = await Promise.allSettled(
        input.telemetry.participants.map(async (participant) =>
          input.started
            .getContainer(`${participant.service}-1`)
            .stop({ timeout: participantMs, remove: false, removeVolumes: false }),
        ),
      );
      for (const result of participantStops) {
        if (result.status === 'rejected') {
          errors.push(result.reason);
        }
      }
      try {
        await collector.stop({
          timeout: collectorMs,
          remove: false,
          removeVolumes: false,
        });
      } catch (error) {
        errors.push(error);
      }
      if (errors.length > 0) {
        throw new AggregateError(errors, 'One or more telemetry-aware services failed to stop');
      }
    },
  };
}

/** The longest a participant may take to exit after SIGTERM before Docker kills it. */
const PARTICIPANT_GRACE_MAX_SECONDS = 10;

/**
 * Splits a stop budget into grace periods, in the milliseconds testcontainers
 * expects (it truncates them to whole seconds for Docker; passing seconds made
 * every grace 0 s, so the collector was killed mid-drain and never recorded its
 * close). A quarter of the budget stays in reserve for Docker itself, so a
 * participant that ignores SIGTERM cannot push the drain past the caller's
 * deadline. Participants get at most 10 s; the collector a third of the grace.
 * The grace never exceeds the budget, however small.
 */
export function stopGrace(timeoutMs: number): {
  readonly participantMs: number;
  readonly collectorMs: number;
} {
  // Whole seconds (Docker's unit), never more than the budget: a budget under
  // two seconds leaves no grace, and Docker stops the containers at once.
  const totalSeconds = Math.max(0, Math.floor(timeoutMs / 1_000));
  const graceSeconds = totalSeconds - Math.ceil(totalSeconds / 4);
  const collectorSeconds = Math.ceil(graceSeconds / 3);
  const participantSeconds = Math.min(
    PARTICIPANT_GRACE_MAX_SECONDS,
    Math.max(0, graceSeconds - collectorSeconds),
  );
  return { participantMs: participantSeconds * 1_000, collectorMs: collectorSeconds * 1_000 };
}
