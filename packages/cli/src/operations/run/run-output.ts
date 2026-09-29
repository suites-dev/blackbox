import type {
  CapsuleExecutionLocation,
  CapsuleExecutionOutcome,
  CapsuleProcessOutcome,
} from '@suites/blackbox-capsule';

import { EXIT_CODES, signalExitCode } from '../../cli/exit-codes.js';
import { formatDuration } from '../../cli/output.js';

export function processOutcome(outcome: CapsuleExecutionOutcome): CapsuleProcessOutcome | null {
  if (outcome.kind === 'driver-completed') {
    return outcome.process;
  }
  return outcome.kind === 'exited' ||
    outcome.kind === 'signaled' ||
    outcome.kind === 'executable-not-found'
    ? outcome
    : null;
}

/** Only run passes a child's code through; a driver failure is a Blackbox failure. */
export function runExitCode(outcome: CapsuleExecutionOutcome): number {
  const process = processOutcome(outcome);
  if (process === null) {
    return EXIT_CODES.blackboxFailure;
  }
  switch (process.kind) {
    case 'exited':
      return process.exitCode;
    case 'signaled':
      return signalExitCode(process.signal);
    case 'executable-not-found':
      return EXIT_CODES.executableNotFound;
  }
}

/** The existing driver messages, verbatim. */
export function driverFailureMessage(outcome: CapsuleExecutionOutcome): string | null {
  if (outcome.kind === 'driver-prepare-failed') {
    return `Driver ${JSON.stringify(outcome.driverId)} could not prepare the command: ${outcome.error.message}`;
  }
  if (outcome.kind === 'driver-propagation-refused') {
    return `Driver ${JSON.stringify(outcome.driverId)} did not satisfy ${outcome.propagation.expectation.kind}. Use --allow-untraced to run while retaining this limitation.`;
  }
  return null;
}

export function locationText(location: CapsuleExecutionLocation): string {
  return location.kind === 'host' ? 'host' : `participant ${location.participantId}`;
}

export function processResultText(process: CapsuleProcessOutcome): string {
  switch (process.kind) {
    case 'exited':
      return `exit ${String(process.exitCode)}`;
    case 'signaled':
      return `signal ${process.signal}`;
    case 'executable-not-found':
      return 'not found';
  }
}

export interface RunSummaryInput {
  readonly activity: string;
  readonly capsule: string;
  readonly purpose: string;
  readonly driver: string | null;
  readonly outcome: CapsuleExecutionOutcome;
  readonly durationMs: number;
}

/** The `activity … · capsule …` line(s) printed after the child's own output. */
export function runSummaryLines(input: RunSummaryInput): readonly string[] {
  const via = input.driver === null ? 'host' : `via ${input.driver}`;
  const head = `activity ${input.activity} · capsule ${input.capsule} · ${input.purpose} · ${via}`;
  const process = processOutcome(input.outcome);
  if (process === null) {
    return [
      `${head} · not run`,
      `blackbox: ${driverFailureMessage(input.outcome) ?? input.outcome.kind}`,
    ];
  }
  return [
    `${head} · ${locationText(process.location)} · ${processResultText(process)} · ${formatDuration(input.durationMs)}`,
  ];
}
