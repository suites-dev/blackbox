import { resolve } from 'node:path';

import type { ClientExecutionInput } from '@suites/blackbox-client';
import type { ResolvedCatalogClient } from '@suites/blackbox-catalog-internal';
import { createNodeTelemetryEnvironment } from '@suites/blackbox-inst-runtime-node';
import type { SandboxHandle } from '@suites/blackbox-sandbox-internal';

import type { CapsuleTelemetryAuthorization } from '../manager/telemetry.js';
import type { CapsuleClientOutcome } from '../types.js';
import type { ClientChildResult } from './client-child.js';

export interface ClientTelemetryInput {
  readonly projectDirectory: string;
  readonly sessionId: string;
  readonly executionId: string;
  readonly activityId: string;
  readonly client: ResolvedCatalogClient;
  readonly sandbox: SandboxHandle;
  readonly authorization: CapsuleTelemetryAuthorization;
}

export async function completedClientTelemetry(input: {
  readonly sandbox: SandboxHandle;
  readonly behavior: 'entrypoint' | 'utility';
  readonly child: ClientChildResult;
  readonly activityId: string;
  readonly authorization: CapsuleTelemetryAuthorization;
}): Promise<CapsuleClientOutcome['telemetry']> {
  if (input.behavior === 'utility') {
    if (input.child.exitCode !== 0) {
      throw new Error(`Utility client exited with ${String(input.child.exitCode)}`);
    }
    return { kind: 'not-requested' };
  }
  if (input.child.exitCode !== 0) {
    return {
      kind: 'incomplete',
      error: {
        name: 'ClientTelemetryIncomplete',
        message: `Client telemetry process exited with ${String(input.child.exitCode)}: ${input.child.stderr}`,
      },
    };
  }
  const status = await input.sandbox.inspectTelemetry();
  if (status.kind !== 'available') {
    return {
      kind: 'incomplete',
      error:
        status.kind === 'unavailable'
          ? status.error
          : { name: 'ClientTelemetryIncomplete', message: 'Collector telemetry is disabled.' },
    };
  }
  try {
    const response = await fetch(
      `${status.endpoints.readUrl}/activities/${encodeURIComponent(input.activityId)}`,
      { headers: { authorization: `Bearer ${input.authorization.token}` } },
    );
    const result: unknown = await response.json();
    const resultKind =
      typeof result === 'object' && result !== null && 'kind' in result
        ? result.kind
        : 'invalid-response';
    if (response.ok && resultKind === 'collector-activity-found') {
      return { kind: 'complete' };
    }
    return {
      kind: 'incomplete',
      error: {
        name: 'ClientTelemetryIncomplete',
        message: `Collector did not retain activity ${input.activityId} (${String(resultKind)}).`,
      },
    };
  } catch (error) {
    const normalized = error instanceof Error ? error : new Error(String(error));
    return {
      kind: 'incomplete',
      error: { name: normalized.name, message: normalized.message },
    };
  }
}

export async function prepareClientTelemetry(
  input: ClientTelemetryInput,
  behavior: 'entrypoint' | 'utility',
): Promise<{
  readonly contract: ClientExecutionInput['telemetry'];
  readonly environment: Readonly<Record<string, string>>;
  readonly argv: (runner: string) => [string, ...string[]];
}> {
  if (behavior === 'utility') {
    return {
      contract: { kind: 'disabled' },
      environment: {},
      argv: (runner) => [process.execPath, runner],
    };
  }
  const status = await input.sandbox.inspectTelemetry();
  if (status.kind !== 'available') {
    throw new Error('Collector is unavailable; refusing a new traced client activity');
  }
  const environment = createNodeTelemetryEnvironment({
    kind: 'node-telemetry-environment',
    tracesEndpoint: status.endpoints.tracesUrl,
    activationEndpoint: status.endpoints.activationUrl,
    authorizationToken: input.authorization.token,
    sessionId: input.sessionId,
    executionId: input.executionId,
    serviceName: `blackbox-client-${input.client.id}`,
  }).variables;
  const bootstrap = resolve(
    input.projectDirectory,
    '.blackbox',
    'instrumentation',
    'instrumentation.js',
  );
  return {
    contract: {
      kind: 'enabled',
      sessionId: input.sessionId,
      executionId: input.executionId,
      activityId: input.activityId,
    },
    environment,
    argv: (runner) => [process.execPath, '--require', bootstrap, runner],
  };
}
