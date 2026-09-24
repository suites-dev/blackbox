import { access, realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import type { SandboxCollectorRuntime, SandboxInput } from '../types.js';

const ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;
const SERVICE_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;

export class SandboxInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SandboxInputError';
  }
}

function requireUnique(values: readonly string[], label: string): void {
  if (new Set(values).size !== values.length) {
    throw new SandboxInputError(`${label} must not contain duplicates`);
  }
}

function validateRelativePath(path: string): void {
  if (path.length === 0 || isAbsolute(path)) {
    throw new SandboxInputError('compose files must be non-empty relative paths');
  }
  const parts = path.split(/[\\/]/u);
  if (parts.includes('..')) {
    throw new SandboxInputError(`compose file escapes projectDirectory: ${path}`);
  }
}

function isWithin(parent: string, child: string): boolean {
  const path = relative(parent, child);
  return path === '' || (!path.startsWith(`..${sep}`) && path !== '..');
}

export async function validateSandboxInput(input: SandboxInput): Promise<void> {
  validateLocations(input);
  const services = selectedServices(input);
  validateServices(services);
  validateEndpoints({ endpoints: input.endpoints, services });
  validateEnvironment(input.environment);
  validateTimeouts(input);
  await validateComposeFiles(input);
  await validateTelemetry(input);
}

async function validateTelemetry(input: SandboxInput): Promise<void> {
  if (input.telemetry.kind === 'disabled') {
    return;
  }
  const telemetry = input.telemetry;
  if (!ID_PATTERN.test(telemetry.sessionId) || !ID_PATTERN.test(telemetry.executionId)) {
    throw new SandboxInputError('telemetry sessionId and executionId must be valid identifiers');
  }
  if (telemetry.authorization.token.trim().length === 0) {
    throw new SandboxInputError('telemetry bearer token must not be blank');
  }
  if (!SERVICE_PATTERN.test(telemetry.collector.service)) {
    throw new SandboxInputError('telemetry collector service name is invalid');
  }
  if (selectedServices(input).includes(telemetry.collector.service)) {
    throw new SandboxInputError('telemetry collector service must not replace an application service');
  }
  const runtime = telemetry.collector.runtime;
  if (runtime.image.trim().length === 0) {
    throw new SandboxInputError('telemetry collector image must not be blank');
  }
  await validateCollectorRuntime(runtime);
  const participantServices = telemetry.participants.map((participant) => participant.service);
  requireUnique(participantServices, 'telemetry participant services');
  for (const participant of telemetry.participants) {
    if (!selectedServices(input).includes(participant.service)) {
      throw new SandboxInputError(
        `telemetry participant ${participant.service} is not a selected service`,
      );
    }
    if (participant.runtime.trim().length === 0) {
      throw new SandboxInputError(`telemetry participant ${participant.service} has no runtime`);
    }
    validateEnvironment(participant.environment);
    for (const mount of participant.mounts) {
      if (!isAbsolute(mount.source) || !isAbsolute(mount.target)) {
        throw new SandboxInputError('telemetry mount source and target must be absolute paths');
      }
      await access(mount.source);
    }
  }
  validateEnvironment(telemetry.collector.environment);
  validateCollectorNumber(telemetry.collector.containerPort, 'collector container port', 65_535);
  validateCollectorNumber(telemetry.collector.readiness.intervalSeconds, 'readiness interval', 300);
  validateCollectorNumber(telemetry.collector.readiness.timeoutSeconds, 'readiness timeout', 300);
  validateCollectorNumber(telemetry.collector.readiness.retries, 'readiness retries', 1_000);
  if (!telemetry.collector.readiness.path.startsWith('/')) {
    throw new SandboxInputError('collector readiness path must start with /');
  }
}

async function validateCollectorRuntime(
  runtime: SandboxCollectorRuntime,
): Promise<void> {
  if (runtime.kind === 'image-default') {
    return;
  }
  if (!isAbsolute(runtime.sourceDirectory) || !isAbsolute(runtime.targetDirectory)) {
    throw new SandboxInputError('telemetry collector runtime paths must be absolute');
  }
  if (isAbsolute(runtime.entrypoint) || runtime.user.trim().length === 0) {
    throw new SandboxInputError('telemetry collector runtime entrypoint and user are invalid');
  }
  const sourceDirectory = await realpath(runtime.sourceDirectory);
  const entrypoint = await realpath(resolve(sourceDirectory, runtime.entrypoint));
  if (!isWithin(sourceDirectory, entrypoint)) {
    throw new SandboxInputError('telemetry collector entrypoint escapes its runtime');
  }
}

function validateCollectorNumber(value: number, label: string, maximum: number): void {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new SandboxInputError(`${label} must be an integer between 1 and ${maximum}`);
  }
}

function validateLocations(input: SandboxInput): void {
  if (!ID_PATTERN.test(input.sandboxId)) {
    throw new SandboxInputError(
      'sandboxId must be 1-128 characters using letters, digits, dot, underscore, or hyphen',
    );
  }
  if (!isAbsolute(input.projectDirectory)) {
    throw new SandboxInputError('projectDirectory must be absolute');
  }
  if (!isAbsolute(input.recordDirectory)) {
    throw new SandboxInputError('recordDirectory must be absolute');
  }
  if (input.composeFiles.length === 0) {
    throw new SandboxInputError('composeFiles must contain at least one file');
  }
  for (const path of input.composeFiles) {
    validateRelativePath(path);
  }
  requireUnique(input.composeFiles, 'composeFiles');
}

function selectedServices(input: SandboxInput): readonly string[] {
  return input.serviceSelection.kind === 'selected'
    ? input.serviceSelection.services
    : input.serviceSelection.declaredServices;
}

function validateServices(services: readonly string[]): void {
  for (const service of services) {
    if (!SERVICE_PATTERN.test(service)) {
      throw new SandboxInputError(`invalid service name: ${service}`);
    }
  }
  requireUnique(services, 'services');
  if (services.length === 0) {
    throw new SandboxInputError('serviceSelection must declare at least one service');
  }
}

function validateEndpoints(input: {
  readonly endpoints: SandboxInput['endpoints'];
  readonly services: readonly string[];
}): void {
  const endpointNames = input.endpoints.map((endpoint) => endpoint.name);
  requireUnique(endpointNames, 'endpoint names');
  for (const endpoint of input.endpoints) {
    if (!ID_PATTERN.test(endpoint.name)) {
      throw new SandboxInputError(`invalid endpoint name: ${endpoint.name}`);
    }
    if (!SERVICE_PATTERN.test(endpoint.service)) {
      throw new SandboxInputError(`invalid endpoint service: ${endpoint.service}`);
    }
    if (
      !Number.isSafeInteger(endpoint.containerPort) ||
      endpoint.containerPort < 1 ||
      endpoint.containerPort > 65_535
    ) {
      throw new SandboxInputError(`invalid container port for endpoint ${endpoint.name}`);
    }
    if (!input.services.includes(endpoint.service)) {
      throw new SandboxInputError(
        `endpoint ${endpoint.name} refers to service ${endpoint.service}, which is not selected`,
      );
    }
  }
}

function validateEnvironment(environment: SandboxInput['environment']): void {
  for (const [name, value] of Object.entries(environment)) {
    if (name.length === 0 || name.includes('=')) {
      throw new SandboxInputError(`invalid environment variable name: ${name}`);
    }
    if (typeof value !== 'string') {
      throw new SandboxInputError(`environment variable ${name} must be a string`);
    }
  }
}

function validateTimeouts(input: SandboxInput): void {
  for (const [name, value] of [
    ['startupTimeoutMs', input.startupTimeoutMs],
    ['stopTimeoutMs', input.stopTimeoutMs],
  ] as const) {
    if (!Number.isSafeInteger(value) || value < 1 || value > 3_600_000) {
      throw new SandboxInputError(`${name} must be an integer between 1 and 3600000`);
    }
  }
}

async function validateComposeFiles(input: SandboxInput): Promise<void> {
  const projectDirectory = await realpath(input.projectDirectory);
  for (const composeFile of input.composeFiles) {
    const candidate = resolve(projectDirectory, composeFile);
    await access(candidate);
    const canonical = await realpath(candidate);
    if (!isWithin(projectDirectory, canonical)) {
      throw new SandboxInputError(`compose file escapes projectDirectory: ${composeFile}`);
    }
  }
}
