import type { DriverArgvRedaction } from '@suites/blackbox-driver';
import type {
  CompletedTelemetryExecutionScopeRecord,
  TelemetryPropagationRecord,
} from '@suites/blackbox-telemetry';

import type { CapsuleActivityReport } from '../model/execution/activity.js';
import type {
  CapsuleExecutionOutcome,
  CapsuleRawCommandOutcome,
} from '../model/execution/outcome.js';
import type { CapsuleProcessOutcome } from '../model/execution/process-outcome.js';
import type { CapsuleRecordedError } from '../model/recorded-error.js';
import type { CapsuleReportActivity } from './types.js';

import { isUnstartedProcess } from '../execution/unstarted-process.js';
import {
  createRedactionContext,
  redactArgv,
  redactText,
  type RedactionContext,
} from './redaction/text.js';

export { createRedactionContext, redactText } from './redaction/text.js';

const noExplicitRedaction = { kind: 'none' } as const;

function redactProcess(
  outcome: CapsuleProcessOutcome,
  location: string,
  context: RedactionContext,
  explicit: DriverArgvRedaction,
): CapsuleProcessOutcome {
  const argv = redactArgv({ argv: outcome.argv, location: `${location}.argv`, context, explicit });
  if (isUnstartedProcess(outcome)) {
    return {
      ...outcome,
      argv,
      remediation: redactText(outcome.remediation, `${location}.remediation`, context),
    };
  }
  const output = {
    ...outcome,
    argv,
    stdout: redactText(outcome.stdout, `${location}.stdout`, context),
    stderr: redactText(outcome.stderr, `${location}.stderr`, context),
  };
  return output;
}

function redactPropagation(
  propagation: TelemetryPropagationRecord,
  location: string,
  context: RedactionContext,
): TelemetryPropagationRecord {
  const outcome = propagation.outcome;
  if (outcome.kind !== 'context-injection-failed') {
    return propagation;
  }
  return {
    ...propagation,
    outcome: {
      ...outcome,
      message: redactText(outcome.message, `${location}.outcome.message`, context),
    },
  };
}

function redactOutcome(
  outcome: CapsuleExecutionOutcome,
  location: string,
  context: RedactionContext,
): CapsuleExecutionOutcome {
  switch (outcome.kind) {
    case 'driver-completed':
      return {
        ...outcome,
        propagation: redactPropagation(
          outcome.propagation,
          `${location}.propagation`,
          context,
        ),
        process: redactProcess(
          outcome.process,
          `${location}.process`,
          context,
          outcome.redaction.preparedArgv,
        ),
      };
    case 'driver-prepare-failed':
      return {
        ...outcome,
        propagation: redactPropagation(
          outcome.propagation,
          `${location}.propagation`,
          context,
        ),
        error: redactError({ error: outcome.error, location: `${location}.error`, context }),
      };
    case 'driver-propagation-refused':
      return {
        ...outcome,
        propagation: redactPropagation(
          outcome.propagation,
          `${location}.propagation`,
          context,
        ),
      };
    case 'executable-not-found':
    case 'not-executable':
    case 'exited':
    case 'signaled':
      return 'propagation' in outcome
        ? ({
            ...redactProcess(outcome, location, context, noExplicitRedaction),
            propagation: outcome.propagation,
          } satisfies CapsuleRawCommandOutcome)
        : redactProcess(outcome, location, context, noExplicitRedaction);
  }
}

function redactionForActivity(activity: CapsuleActivityReport): DriverArgvRedaction {
  return activity.kind === 'completed' && activity.outcome.kind === 'driver-completed'
    ? activity.outcome.redaction.requestArgv
    : noExplicitRedaction;
}

function redactCompletedTelemetry(
  telemetry: CompletedTelemetryExecutionScopeRecord,
  location: string,
  context: RedactionContext,
): CompletedTelemetryExecutionScopeRecord {
  if (telemetry.result.kind === 'telemetry-scope-failed') {
    return {
      ...telemetry,
      result: {
        ...telemetry.result,
        message: redactText(telemetry.result.message, `${location}.result.message`, context),
      },
    };
  }
  if (telemetry.result.kind === 'telemetry-scope-interrupted') {
    return {
      ...telemetry,
      result: {
        ...telemetry.result,
        reason: redactText(telemetry.result.reason, `${location}.result.reason`, context),
      },
    };
  }
  return telemetry;
}

/**
 * The outcome as `capsule run --json` prints it: every argv passes through
 * the report's argv redaction (with the positions a driver declared), and
 * argv[0], the executable, is kept. Nothing else changes: the child's output
 * stays as captured, and what is persisted is never touched.
 */
export function redactOutcomeArgv(outcome: CapsuleExecutionOutcome): CapsuleExecutionOutcome {
  const redacted = (argv: readonly string[], explicit: DriverArgvRedaction): readonly string[] => {
    const masked = redactArgv({
      argv,
      location: 'outcome.argv',
      context: createRedactionContext(),
      explicit,
    });
    return argv.length === 0 ? masked : [argv[0], ...masked.slice(1)];
  };
  switch (outcome.kind) {
    case 'driver-completed':
      return {
        ...outcome,
        process: {
          ...outcome.process,
          argv: redacted(outcome.process.argv, outcome.redaction.preparedArgv),
        },
      };
    case 'driver-prepare-failed':
    case 'driver-propagation-refused':
      return outcome;
    case 'executable-not-found':
    case 'not-executable':
    case 'exited':
    case 'signaled':
      return { ...outcome, argv: redacted(outcome.argv, noExplicitRedaction) };
  }
}

export function redactActivities(input: {
  readonly activities: readonly CapsuleActivityReport[];
  readonly context: RedactionContext;
}): readonly CapsuleReportActivity[] {
  return input.activities.map((activity, index) => {
    const location = `activities[${String(index)}]`;
    const argv = redactArgv({
      argv: activity.argv,
      location: `${location}.argv`,
      context: input.context,
      explicit: redactionForActivity(activity),
    });
    switch (activity.kind) {
      case 'running':
        return { ...activity, argv };
      case 'completed':
        return {
          ...activity,
          argv,
          telemetry: redactCompletedTelemetry(
            activity.telemetry,
            `${location}.telemetry`,
            input.context,
          ),
          outcome: redactOutcome(activity.outcome, `${location}.outcome`, input.context),
        };
      case 'interrupted':
      case 'failed':
        return {
          ...activity,
          argv,
          telemetry: redactCompletedTelemetry(
            activity.telemetry,
            `${location}.telemetry`,
            input.context,
          ),
          error: redactError({
            error: activity.error,
            location: `${location}.error`,
            context: input.context,
          }),
        };
    }
  });
}

export function redactError(input: {
  readonly error: CapsuleRecordedError;
  readonly location: string;
  readonly context: RedactionContext;
}): CapsuleRecordedError {
  return {
    name: input.error.name,
    message: redactText(input.error.message, `${input.location}.message`, input.context),
  };
}

export function redactStandaloneError(error: unknown): CapsuleRecordedError {
  const recorded =
    error instanceof Error
      ? { name: error.name, message: error.message }
      : { name: 'Error', message: String(error) };
  return redactError({
    error: recorded,
    location: 'artifact.error',
    context: createRedactionContext(),
  });
}
