import type { ClientExecutionInput, ClientProcessResult } from '@suites/blackbox-client';
import type { ResolvedCatalogClient } from '@suites/blackbox-catalog-internal';
import type { SandboxHandle } from '@suites/blackbox-sandbox-internal';

import type { CapsuleTelemetryAuthorization } from '../manager/telemetry.js';
import type { CapsuleClientOutcome } from '../types.js';
import { clientEndpointName } from './client-endpoint.js';
import {
  clientInspectionResult,
  clientProcessResult,
  parseClientJson,
  runClientChild,
} from './client-child.js';
import { writeClientRunners } from './client-runner-files.js';
import {
  completedClientTelemetry,
  prepareClientTelemetry,
} from './client-telemetry.js';

export interface RunCapsuleClientInput {
  readonly projectDirectory: string;
  readonly sessionId: string;
  readonly executionId: string;
  readonly activityId: string;
  readonly client: ResolvedCatalogClient;
  readonly args: readonly string[];
  readonly sandbox: SandboxHandle;
  readonly authorization: CapsuleTelemetryAuthorization;
}

function executionTarget(input: {
  readonly sandbox: SandboxHandle;
  readonly client: ResolvedCatalogClient;
}): ClientExecutionInput['target'] {
  const endpoint = input.sandbox.endpoints.get(clientEndpointName(input.client.id));
  if (endpoint === undefined) {
    throw new Error(`Sandbox did not expose endpoint for client ${input.client.id}`);
  }
  const target = input.client.target;
  return {
    kind: target.kind,
    participantId: target.participantId,
    service: target.service,
    endpoint: {
      protocol: target.protocol,
      host: endpoint.host,
      port: endpoint.port,
      url: `${target.protocol}://${endpoint.host}:${String(endpoint.port)}`,
    },
    environment: {
      BLACKBOX_CLIENT_HOST: endpoint.host,
      BLACKBOX_CLIENT_PORT: String(endpoint.port),
      BLACKBOX_CLIENT_PROTOCOL: target.protocol,
      BLACKBOX_CLIENT_SERVICE: target.service,
      BLACKBOX_CLIENT_PARTICIPANT: target.participantId,
    },
  };
}

async function inspectClient(input: RunCapsuleClientInput, runner: string) {
  const child = await runClientChild({
    argv: [process.execPath, runner],
    cwd: input.projectDirectory,
    environment: {},
    stdin: '',
  });
  const result = clientInspectionResult(parseClientJson(child, 'Client inspection'));
  if (result.kind === 'unavailable') {
    throw new Error(`${result.error.name}: ${result.error.message}`);
  }
  if (result.client.name !== input.client.id) {
    throw new Error(
      `Client name ${JSON.stringify(result.client.name)} must match catalog ID ${JSON.stringify(input.client.id)}`,
    );
  }
  if (result.client.kind === 'entrypoint' && input.client.target.kind !== 'entrypoint') {
    throw new Error('An entrypoint client must target the selected system entrypoint');
  }
  return result.client;
}

async function executeClient(input: {
  readonly request: RunCapsuleClientInput;
  readonly runner: string;
  readonly behavior: 'entrypoint' | 'utility';
}): Promise<{ readonly child: Awaited<ReturnType<typeof runClientChild>>; readonly result: ClientProcessResult }> {
  const telemetry = await prepareClientTelemetry(input.request, input.behavior);
  const execution = {
    args: [...input.request.args],
    target: executionTarget(input.request),
    telemetry: telemetry.contract,
  } satisfies ClientExecutionInput;
  const child = await runClientChild({
    argv: telemetry.argv(input.runner),
    cwd: input.request.projectDirectory,
    environment: telemetry.environment,
    stdin: JSON.stringify(execution),
  });
  try {
    return { child, result: clientProcessResult(JSON.parse(child.stdout) as unknown) };
  } catch (error) {
    throw new Error(`Client execution returned invalid JSON: ${child.stderr}`, { cause: error });
  }
}

export async function runCapsuleClient(
  input: RunCapsuleClientInput,
): Promise<CapsuleClientOutcome> {
  const runners = await writeClientRunners(input);
  const identity = await inspectClient(input, runners.inspect);
  const executed = await executeClient({
    request: input,
    runner: runners.execute,
    behavior: identity.kind,
  });
  if (executed.result.kind === 'failed') {
    throw new Error(`${executed.result.error.name}: ${executed.result.error.message}`);
  }
  return {
    kind: 'client-completed',
    client: {
      id: input.client.id,
      name: executed.result.metadata.client.name,
      behavior: executed.result.metadata.client.kind,
    },
    result: executed.result.result,
    telemetry: await completedClientTelemetry({
      sandbox: input.sandbox,
      behavior: identity.kind,
      child: executed.child,
      activityId: input.activityId,
      authorization: input.authorization,
    }),
  };
}
