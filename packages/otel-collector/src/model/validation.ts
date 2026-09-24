import { isAbsolute } from 'node:path';
import type { StartCollectorInput } from './types.js';

const IDENTITY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const PATH_PATTERN = /^\/[A-Za-z0-9._~!$&'()*+,;=:@/-]*$/u;

function validatePath(input: { readonly name: string; readonly value: string }): void {
  if (!PATH_PATTERN.test(input.value) || input.value.includes('//') || input.value.endsWith('/')) {
    throw new Error(
      `${input.name} must be an absolute HTTP path without an empty segment or trailing slash.`,
    );
  }
}

export function validateIdentity(input: {
  readonly sessionId: string;
  readonly executionId: string;
}): void {
  if (!IDENTITY_PATTERN.test(input.sessionId)) {
    throw new Error('sessionId must be a safe non-empty identifier of at most 128 characters.');
  }
  if (!IDENTITY_PATTERN.test(input.executionId)) {
    throw new Error('executionId must be a safe non-empty identifier of at most 128 characters.');
  }
}

export function validateStartInput(input: StartCollectorInput): void {
  validateIdentity(input);
  if (!isAbsolute(input.storageDirectory)) {
    throw new Error('storageDirectory must be an absolute path.');
  }
  if (input.endpoint.host.trim() === '') {
    throw new Error('endpoint.host must be explicit and non-empty.');
  }
  if (
    !Number.isInteger(input.endpoint.port) ||
    input.endpoint.port < 0 ||
    input.endpoint.port > 65_535
  ) {
    throw new Error('endpoint.port must be an integer from 0 through 65535.');
  }
  validatePath({ name: 'endpoint.tracesPath', value: input.endpoint.tracesPath });
  validatePath({ name: 'endpoint.activationPath', value: input.endpoint.activationPath });
  validatePath({ name: 'endpoint.readinessPath', value: input.endpoint.readinessPath });
  validatePath({ name: 'endpoint.readPath', value: input.endpoint.readPath });
  const paths = [
    input.endpoint.tracesPath,
    input.endpoint.activationPath,
    input.endpoint.readinessPath,
    input.endpoint.readPath,
  ];
  if (new Set(paths).size !== paths.length) {
    throw new Error('Trace ingest, activation, readiness, and read paths must differ.');
  }
  if (input.authorization.token.trim() === '') {
    throw new Error('authorization.token must be explicit and non-empty.');
  }
  if (!Number.isSafeInteger(input.limits.maxRequestBytes) || input.limits.maxRequestBytes < 1) {
    throw new Error('limits.maxRequestBytes must be a positive safe integer.');
  }
  if (!Number.isSafeInteger(input.limits.shutdownTimeoutMs) || input.limits.shutdownTimeoutMs < 1) {
    throw new Error('limits.shutdownTimeoutMs must be a positive safe integer.');
  }
}

export function validateNonBlankField(input: {
  readonly field: string;
  readonly value: unknown;
}): string {
  if (typeof input.value !== 'string' || input.value.trim() === '') {
    throw new Error(`${input.field} must be a non-empty string.`);
  }
  return input.value;
}

export function validateTraceId(traceId: string): string {
  if (!/^[\da-f]{32}$/iu.test(traceId) || /^0+$/u.test(traceId)) {
    throw new Error('traceId must be a non-zero 32-character hexadecimal trace ID.');
  }
  return traceId.toLowerCase();
}

export function recordedFailure(error: unknown): {
  readonly name: string;
  readonly message: string;
} {
  const candidate =
    error instanceof Error
      ? { name: error.name, message: error.message }
      : { name: 'Error', message: String(error) };
  return {
    name: candidate.name,
    message: candidate.message === '' ? 'Unknown collector failure.' : candidate.message,
  };
}
