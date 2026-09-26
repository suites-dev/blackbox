import type { CapsuleSessionRecord } from '../records.js';
import type { CapsuleManagerOwnership } from '../types.js';

type JsonObject = Record<string, unknown>;
type ValidatedSessionRecord = JsonObject & Omit<CapsuleSessionRecord, 'manager'>;

export function object(value: unknown, location: string): JsonObject {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${location} must be an object`);
  }
  return value as JsonObject;
}

export function string(value: unknown, location: string): string {
  if (typeof value !== 'string') {
    throw new Error(`${location} must be a string`);
  }
  return value;
}

export function number(value: unknown, location: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${location} must be a finite number`);
  }
  return value;
}

export function stringArray(value: unknown, location: string): readonly string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    throw new Error(`${location} must be an array of strings`);
  }
  return value;
}

export function discriminator(value: JsonObject, allowed: readonly string[], location: string): string {
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

function manager(value: unknown): CapsuleManagerOwnership {
  const item = object(value, 'session.manager');
  if (discriminator(item, ['not-started', 'started'], 'session.manager') === 'not-started') {
    return { kind: 'not-started' };
  }
  const pid = number(item.pid, 'session.manager.pid');
  if (item.identity === undefined) {
    return { kind: 'started', pid, identity: { kind: 'legacy-pid-only' } };
  }
  const identity = object(item.identity, 'session.manager.identity');
  if (
    discriminator(
      identity,
      ['legacy-pid-only', 'socket-instance'],
      'session.manager.identity',
    ) === 'legacy-pid-only'
  ) {
    return { kind: 'started', pid, identity: { kind: 'legacy-pid-only' } };
  }
  const instanceId = string(identity.instanceId, 'session.manager.identity.instanceId');
  if (instanceId.length === 0) {
    throw new Error('session.manager.identity.instanceId must not be empty');
  }
  return { kind: 'started', pid, identity: { kind: 'socket-instance', instanceId } };
}

export function recordedError(value: unknown, location: string): void {
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

function validateSession(record: JsonObject): asserts record is ValidatedSessionRecord {
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
  return { ...record, manager: manager(record.manager) };
}
