import type {
  CapsuleActivityReport,
  CapsuleExecutionOutcome,
  CapsuleRecordedError,
} from '../types.js';
import type { JsonObject, JsonValue } from '@suites/blackbox-client';
import type { CapsuleReportActivity, CapsuleReportRedaction } from './types.js';

const MASK = '[REDACTED]';
const sensitiveName =
  /(?:authorization|proxy-authorization|cookie|set-cookie|token|secret|password|passwd|api[-_]?key)/iu;
const header = /^(authorization|proxy-authorization|cookie|set-cookie|x-api-key|api-key)\s*:/iu;
const assignment = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/u;
const socketPath = /(?:\/[^\s"']+)?\.blackbox\/(?:s|tmp)\/[^\s"']+\.sock/gu;

interface RedactionContext {
  readonly entries: CapsuleReportRedaction[];
}

function note(
  context: RedactionContext,
  kind: CapsuleReportRedaction['kind'],
  location: string,
): void {
  context.entries.push({ kind, location });
}

export function redactText(input: string, location: string, context: RedactionContext): string {
  let value = input.replace(/\b(Bearer|Basic)\s+[^\s,"'}]+/giu, (_match, scheme: string) => {
    note(context, 'authorization-credential', location);
    return `${scheme} ${MASK}`;
  });
  value = value.replace(socketPath, () => {
    note(context, 'private-ipc-path', location);
    return MASK;
  });
  value = value.replace(
    /\b(authorization|proxy-authorization|cookie|set-cookie|x-api-key|api-key)\s*:\s*[^\r\n,;}]+/giu,
    (match: string) => {
      note(context, 'sensitive-header', location);
      return `${match.slice(0, match.indexOf(':') + 1)} ${MASK}`;
    },
  );
  value = value.replace(
    /("(?:authorization|token|secret|password|passwd|apiKey|api_key|cookie)"\s*:\s*")[^"]*(")/giu,
    (_match, prefix: string, suffix: string) => {
      note(context, 'sensitive-output', location);
      return `${prefix}${MASK}${suffix}`;
    },
  );
  value = value.replace(
    /([?&](?:token|secret|password|passwd|api[-_]?key|authorization)=)[^&#\s]+/giu,
    (_match, prefix: string) => {
      note(context, 'sensitive-output', location);
      return `${prefix}${MASK}`;
    },
  );
  value = value.replace(/\b([A-Za-z_][A-Za-z0-9_]*=)[^\s,;]+/gu, (_match, prefix: string) => {
    note(context, 'environment-value', location);
    return `${prefix}${MASK}`;
  });
  return value;
}

function redactArgument(argument: string, location: string, context: RedactionContext): string {
  const env = assignment.exec(argument);
  if (env !== null) {
    note(context, 'environment-value', location);
    return `${env[1]}=${MASK}`;
  }
  if (header.test(argument)) {
    note(context, 'sensitive-header', location);
    return `${argument.slice(0, argument.indexOf(':') + 1)} ${MASK}`;
  }
  const equals = argument.indexOf('=');
  if (equals > 0 && sensitiveName.test(argument.slice(0, equals))) {
    note(context, 'sensitive-argument', location);
    return `${argument.slice(0, equals + 1)}${MASK}`;
  }
  return redactText(argument, location, context);
}

function redactArgv(
  argv: readonly string[],
  location: string,
  context: RedactionContext,
): readonly string[] {
  let redactNext = false;
  return argv.map((argument, index) => {
    const itemLocation = `${location}[${String(index)}]`;
    if (redactNext) {
      redactNext = false;
      note(context, 'sensitive-argument', itemLocation);
      return MASK;
    }
    if (
      (argument === '--env' || argument === '--environment' || argument === '-e') &&
      !argument.includes('=')
    ) {
      redactNext = true;
      return argument;
    }
    if (argument.startsWith('--') && sensitiveName.test(argument) && !argument.includes('=')) {
      redactNext = true;
      return argument;
    }
    return redactArgument(argument, itemLocation, context);
  });
}

function redactOutcome(
  outcome: CapsuleExecutionOutcome,
  location: string,
  context: RedactionContext,
): CapsuleExecutionOutcome {
  if (outcome.kind === 'client-completed') {
    const result = outcome.result;
    return {
      ...outcome,
      client: {
        ...outcome.client,
        name: redactText(outcome.client.name, `${location}.client.name`, context),
      },
      result:
        result.kind === 'text'
          ? { kind: 'text', value: redactText(result.value, `${location}.result.value`, context) }
          : result.kind === 'json'
            ? {
                kind: 'json',
                value: redactJson(result.value, `${location}.result.value`, context),
              }
            : result,
      telemetry:
        outcome.telemetry.kind === 'incomplete'
          ? {
              kind: 'incomplete',
              error: redactError({
                error: outcome.telemetry.error,
                location: `${location}.telemetry.error`,
                context,
              }),
            }
          : outcome.telemetry,
    };
  }
  const common = {
    argv: redactArgv(outcome.argv, `${location}.argv`, context),
    stdout: redactText(outcome.stdout, `${location}.stdout`, context),
    stderr: redactText(outcome.stderr, `${location}.stderr`, context),
  };
  if (outcome.kind === 'exited') {
    return { kind: 'exited', exitCode: outcome.exitCode, ...common };
  }
  return { kind: 'signaled', signal: outcome.signal, ...common };
}

function redactJson(
  value: JsonValue,
  location: string,
  context: RedactionContext,
): JsonValue {
  if (typeof value === 'string') {
    return redactText(value, location, context);
  }
  if (value === null || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (Array.isArray(value)) {
    const arrayValue: readonly JsonValue[] = value;
    return arrayValue.map((item, index) =>
      redactJson(item, `${location}[${String(index)}]`, context),
    );
  }
  const objectValue = value as JsonObject;
  return Object.fromEntries(
    Object.entries(objectValue).map(([key, item]) => [
      key,
      redactJson(item, `${location}.${key}`, context),
    ]),
  );
}

export function redactActivities(input: {
  readonly activities: readonly CapsuleActivityReport[];
  readonly context: RedactionContext;
}): readonly CapsuleReportActivity[] {
  return input.activities.map((activity, index) => {
    const location = `activities[${String(index)}]`;
    const argv = redactArgv(activity.argv, `${location}.argv`, input.context);
    switch (activity.kind) {
      case 'running':
        return { ...activity, argv };
      case 'completed':
        return {
          ...activity,
          argv,
          outcome: redactOutcome(activity.outcome, `${location}.outcome`, input.context),
        };
      case 'failed':
        return {
          ...activity,
          argv,
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

export function createRedactionContext(): RedactionContext {
  return { entries: [] };
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
