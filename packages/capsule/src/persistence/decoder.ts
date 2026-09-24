import type { CapsuleSessionRecord } from '../records.js';
import type { CapsuleActivityReport } from '../types.js';

type JsonObject = Record<string, unknown>;

function object(value: unknown, location: string): JsonObject {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${location} must be an object`);
  }
  return value as JsonObject;
}

function string(value: unknown, location: string): string {
  if (typeof value !== 'string') {
    throw new Error(`${location} must be a string`);
  }
  return value;
}

function number(value: unknown, location: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${location} must be a finite number`);
  }
  return value;
}

function stringArray(value: unknown, location: string): readonly string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    throw new Error(`${location} must be an array of strings`);
  }
  return value;
}

function discriminator(value: JsonObject, allowed: readonly string[], location: string): string {
  const kind = string(value.kind, `${location}.kind`);
  if (!allowed.includes(kind)) {
    throw new Error(`${location}.kind is unsupported`);
  }
  return kind;
}

function description(value: unknown): void {
  const item = object(value, 'session.description');
  if (discriminator(item, ['provided', 'omitted'], 'session.description') === 'provided') {
    string(item.value, 'session.description.value');
  }
}

function manager(value: unknown): void {
  const item = object(value, 'session.manager');
  if (discriminator(item, ['not-started', 'started'], 'session.manager') === 'started') {
    number(item.pid, 'session.manager.pid');
  }
}

function recordedError(value: unknown, location: string): void {
  const error = object(value, location);
  string(error.name, `${location}.name`);
  string(error.message, `${location}.message`);
}

function availability(
  value: unknown,
  location: string,
  validate: (available: unknown, availableLocation: string) => void,
): void {
  const item = object(value, location);
  if (discriminator(item, ['available', 'unavailable'], location) === 'available') {
    validate(item.value, `${location}.value`);
  }
}

function entrypoint(value: unknown, location: string): void {
  const item = object(value, location);
  string(item.url, `${location}.url`);
  string(item.host, `${location}.host`);
  number(item.port, `${location}.port`);
  string(item.protocol, `${location}.protocol`);
}

function readiness(value: unknown, location: string): void {
  const item = object(value, location);
  string(item.url, `${location}.url`);
  if (item.status !== 'ready') {
    throw new Error(`${location}.status must be ready`);
  }
  number(item.durationMs, `${location}.durationMs`);
}

function container(value: unknown, index: number): void {
  const location = `session.containers[${String(index)}]`;
  const item = object(value, location);
  for (const field of ['participant', 'service', 'containerId', 'containerName', 'host']) {
    string(item[field], `${location}.${field}`);
  }
  stringArray(item.networkNames, `${location}.networkNames`);
}

function cleanup(value: unknown): void {
  const item = object(value, 'session.cleanup');
  if (
    discriminator(item, ['not-attempted', 'complete', 'failed'], 'session.cleanup') === 'failed'
  ) {
    recordedError(item.error, 'session.cleanup.error');
  }
}

function failure(value: unknown): void {
  const item = object(value, 'session.failure');
  if (discriminator(item, ['none', 'recorded'], 'session.failure') === 'recorded') {
    recordedError(item.error, 'session.failure.error');
  }
}

function validateSession(record: JsonObject): void {
  if (record.schemaVersion !== 1) {
    throw new Error('session.schemaVersion must be 1');
  }
  for (const field of [
    'sessionId',
    'executionId',
    'system',
    'title',
    'admittedAt',
    'updatedAt',
    'socketPath',
    'artifactRoot',
  ]) {
    string(record[field], `session.${field}`);
  }
  const state = string(record.state, 'session.state');
  if (
    ![
      'admitted',
      'manager-starting',
      'sandbox-starting',
      'running',
      'stopping',
      'stopped',
      'start-failed',
      'stop-failed',
      'manager-failed',
    ].includes(state)
  ) {
    throw new Error('session.state is unsupported');
  }
  number(record.revision, 'session.revision');
  description(record.description);
  manager(record.manager);
  availability(record.entrypoint, 'session.entrypoint', entrypoint);
  availability(record.composeProject, 'session.composeProject', string);
  availability(record.readiness, 'session.readiness', readiness);
  cleanup(record.cleanup);
  failure(record.failure);
  const cleanupRecord = object(record.cleanup, 'session.cleanup');
  if (state === 'stopped' && cleanupRecord.kind !== 'complete') {
    throw new Error('session.cleanup must be complete when session.state is stopped');
  }
  if (state === 'running') {
    for (const field of ['entrypoint', 'composeProject', 'readiness']) {
      const available = object(record[field], `session.${field}`);
      if (available.kind !== 'available') {
        throw new Error(`session.${field} must be available when session.state is running`);
      }
    }
  }
  if (!Array.isArray(record.containers)) {
    throw new Error('session.containers must be an array');
  }
  record.containers.forEach(container);
  stringArray(record.networks, 'session.networks');
  stringArray(record.volumes, 'session.volumes');
}

export function decodeCapsuleSessionRecord(input: {
  readonly bytes: string;
}): CapsuleSessionRecord {
  const value: unknown = JSON.parse(input.bytes);
  const record = object(value, 'session');
  validateSession(record);
  return value as CapsuleSessionRecord;
}

function validateActivity(value: unknown, index: number): void {
  const location = `activities[${String(index)}]`;
  const activity = object(value, location);
  number(activity.sequence, `${location}.sequence`);
  const target = object(activity.target, `${location}.target`);
  if (discriminator(target, ['host', 'participant'], `${location}.target`) === 'participant') {
    string(target.participant, `${location}.target.participant`);
  }
  stringArray(activity.argv, `${location}.argv`);
  string(activity.startedAt, `${location}.startedAt`);
  string(activity.completedAt, `${location}.completedAt`);
  const outcome = object(activity.outcome, `${location}.outcome`);
  const outcomeKind = discriminator(outcome, ['exited', 'signaled'], `${location}.outcome`);
  stringArray(outcome.argv, `${location}.outcome.argv`);
  string(outcome.stdout, `${location}.outcome.stdout`);
  string(outcome.stderr, `${location}.outcome.stderr`);
  if (outcomeKind === 'exited') {
    number(outcome.exitCode, `${location}.outcome.exitCode`);
  } else {
    string(outcome.signal, `${location}.outcome.signal`);
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
