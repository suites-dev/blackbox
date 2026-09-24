import type { Readable } from 'node:stream';

import { SpanStatusCode, trace } from '@opentelemetry/api';

import type {
  ClientDefinition,
  ClientExecutionInput,
  ClientResult,
} from '../model/client-types.js';
import type {
  ClientProcessResult,
  ClientMetadataAvailability,
  ExecuteClientInput,
  RunNodeClientProcessInput,
} from './runner-types.js';

async function readInput(stream: Readable): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
}

function isDefinition(value: unknown): value is ClientDefinition {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    (record.kind === 'entrypoint' || record.kind === 'utility') &&
    typeof record.name === 'string' &&
    record.name.trim() !== '' &&
    typeof record.run === 'function'
  );
}

function isResult(value: unknown): value is ClientResult {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const result = value as Record<string, unknown>;
  return (
    result.kind === 'empty' ||
    (result.kind === 'text' && typeof result.value === 'string') ||
    (result.kind === 'json' && isJsonValue(result.value, new Set()))
  );
}

function isJsonValue(value: unknown, ancestors: Set<object>): boolean {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean'
  ) {
    return true;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value);
  }
  if (typeof value !== 'object' || ancestors.has(value)) {
    return false;
  }
  if (!Array.isArray(value)) {
    const prototype = Object.getPrototypeOf(value) as object | null;
    if (prototype !== Object.prototype && prototype !== null) {
      return false;
    }
  }
  ancestors.add(value);
  const nested = Array.isArray(value) ? value : Object.values(value);
  const valid = nested.every((entry) => isJsonValue(entry, ancestors));
  ancestors.delete(value);
  return valid;
}

function deepFreeze(value: unknown): unknown {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) {
    return value;
  }
  for (const nested of Object.values(value)) {
    deepFreeze(nested);
  }
  return Object.freeze(value);
}

function cloneAndFreezeExecution(execution: ClientExecutionInput): ClientExecutionInput {
  return deepFreeze(structuredClone(execution)) as ClientExecutionInput;
}

export async function executeClient(input: ExecuteClientInput): Promise<ClientResult> {
  const execution = cloneAndFreezeExecution(input.execution);
  const result =
    input.definition.kind === 'entrypoint'
      ? await executeEntrypointClient(input.definition, execution)
      : await executeUtilityClient(input.definition, execution);
  if (!isResult(result)) {
    throw new Error('Client returned an invalid result');
  }
  return result;
}

async function executeUtilityClient(
  definition: ClientDefinition,
  execution: ClientExecutionInput,
): Promise<ClientResult> {
  if (execution.telemetry.kind !== 'disabled') {
    throw new Error('Utility clients require disabled telemetry');
  }
  return definition.run(execution);
}

async function executeEntrypointClient(
  definition: ClientDefinition,
  execution: ClientExecutionInput,
): Promise<ClientResult> {
  if (execution.telemetry.kind !== 'enabled') {
    throw new Error('Entrypoint clients require enabled telemetry');
  }
  const telemetry = execution.telemetry;
  const tracer = trace.getTracer('@suites/blackbox-client');
  return tracer.startActiveSpan(
    'blackbox.client.entrypoint',
    {
      attributes: {
        'blackbox.session.id': telemetry.sessionId,
        'blackbox.client.execution.id': telemetry.executionId,
        'blackbox.activity.id': telemetry.activityId,
        'blackbox.client.name': definition.name,
      },
    },
    async (span) => {
      try {
        return await definition.run(execution);
      } catch (error) {
        const normalized = error instanceof Error ? error : new Error(String(error));
        span.recordException(normalized);
        span.setStatus({ code: SpanStatusCode.ERROR, message: normalized.message });
        throw error;
      } finally {
        span.end();
      }
    },
  );
}

function failure(
  error: unknown,
  metadata: ClientMetadataAvailability,
): ClientProcessResult {
  const normalized = error instanceof Error ? error : new Error(String(error));
  return {
    kind: 'failed',
    metadata,
    error: { name: normalized.name, message: normalized.message },
  };
}

function unavailableMetadata(): ClientMetadataAvailability {
  return { kind: 'unavailable' };
}

export async function runNodeClientProcess(input: RunNodeClientProcessInput): Promise<void> {
  let response: ClientProcessResult;
  let metadata: ClientMetadataAvailability = unavailableMetadata();
  try {
    if (!isDefinition(input.definition)) {
      throw new Error('Client module default export is not a valid client definition');
    }
    metadata = {
      kind: 'available',
      client: { kind: input.definition.kind, name: input.definition.name },
    };
    const execution = (await readInput(input.input)) as ClientExecutionInput;
    response = {
      kind: 'completed',
      metadata,
      result: await executeClient({ definition: input.definition, execution }),
    };
  } catch (error) {
    response = failure(error, metadata);
  }
  input.output.write(`${JSON.stringify(response)}\n`);
}
