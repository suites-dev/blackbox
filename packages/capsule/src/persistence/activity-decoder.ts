import type { CapsuleActivityReport } from '../types.js';
import {
  discriminator,
  number,
  object,
  recordedError,
  string,
  stringArray,
} from './decoder.js';

function validateClientOutcome(outcome: Record<string, unknown>, location: string): void {
  const client = object(outcome.client, `${location}.client`);
  string(client.id, `${location}.client.id`);
  string(client.name, `${location}.client.name`);
  if (client.behavior !== 'entrypoint' && client.behavior !== 'utility') {
    throw new Error(`${location}.client.behavior is unsupported`);
  }
  const result = object(outcome.result, `${location}.result`);
  const resultKind = discriminator(result, ['json', 'text', 'empty'], `${location}.result`);
  if (resultKind === 'text') {
    string(result.value, `${location}.result.value`);
  }
  if (resultKind === 'json' && !Object.hasOwn(result, 'value')) {
    throw new Error(`${location}.result.value is required`);
  }
  const telemetry = object(outcome.telemetry, `${location}.telemetry`);
  if (
    discriminator(
      telemetry,
      ['not-requested', 'complete', 'incomplete'],
      `${location}.telemetry`,
    ) === 'incomplete'
  ) {
    recordedError(telemetry.error, `${location}.telemetry.error`);
  }
}

function validateCompletedActivity(activity: Record<string, unknown>, location: string): void {
  const outcome = object(activity.outcome, `${location}.outcome`);
  const outcomeKind = discriminator(
    outcome,
    ['exited', 'signaled', 'client-completed'],
    `${location}.outcome`,
  );
  if (outcomeKind === 'client-completed') {
    validateClientOutcome(outcome, `${location}.outcome`);
    return;
  }
  stringArray(outcome.argv, `${location}.outcome.argv`);
  string(outcome.stdout, `${location}.outcome.stdout`);
  string(outcome.stderr, `${location}.outcome.stderr`);
  if (outcomeKind === 'exited') {
    number(outcome.exitCode, `${location}.outcome.exitCode`);
  } else {
    string(outcome.signal, `${location}.outcome.signal`);
  }
}

function validateActivity(value: unknown, index: number): void {
  const location = `activities[${String(index)}]`;
  const activity = object(value, location);
  string(activity.activityId, `${location}.activityId`);
  number(activity.sequence, `${location}.sequence`);
  const target = object(activity.target, `${location}.target`);
  const targetKind = discriminator(target, ['host', 'participant', 'client'], `${location}.target`);
  if (targetKind === 'participant') {
    string(target.participant, `${location}.target.participant`);
  } else if (targetKind === 'client') {
    string(target.clientId, `${location}.target.clientId`);
  }
  stringArray(activity.argv, `${location}.argv`);
  string(activity.startedAt, `${location}.startedAt`);
  const kind = discriminator(activity, ['running', 'completed', 'failed'], location);
  if (kind === 'running') {
    return;
  }
  string(activity.completedAt, `${location}.completedAt`);
  if (kind === 'failed') {
    recordedError(activity.error, `${location}.error`);
  } else {
    validateCompletedActivity(activity, location);
  }
}

export function decodeCapsuleActivities(input: {
  readonly bytes: string;
}): readonly CapsuleActivityReport[] {
  const value: unknown = JSON.parse(input.bytes);
  if (!Array.isArray(value)) {
    throw new Error('activities must be an array');
  }
  value.forEach(validateActivity);
  return value as CapsuleActivityReport[];
}
