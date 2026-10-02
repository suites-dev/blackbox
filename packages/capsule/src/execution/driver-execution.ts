import type { ResolvedCatalogDriver } from '@suites/blackbox-catalog';
import type { SandboxHandle } from '@suites/blackbox-sandbox';
import type { TelemetryExecutionScope } from '@suites/blackbox-telemetry';

import type { CapsuleEntrypoint } from '../model/environment.js';
import type { CapsuleExecutionInteraction } from '../model/interaction.js';
import type { CapsuleDriverOutcome } from '../model/outcome.js';
import { prepareCapsuleDriver } from './driver/preparation.js';
import { runPreparedCommand } from './driver/process/prepared-command.js';
import { driverEnvironment, propagationRefused } from './driver/propagation.js';
import { createDriverPrepareRequest } from './driver/request.js';
import { executionSecrets } from './driver/secrets.js';

export interface RunCapsuleDriverInput {
  readonly projectDirectory: string;
  readonly sessionId: string;
  readonly activityId: string;
  readonly entrypoint: CapsuleEntrypoint;
  readonly driver: ResolvedCatalogDriver;
  readonly argv: readonly [string, ...string[]];
  readonly untraced: { readonly kind: 'refuse' } | { readonly kind: 'allow' };
  readonly sandbox: SandboxHandle;
  readonly scope: TelemetryExecutionScope;
  readonly interaction: CapsuleExecutionInteraction;
}

function driverDetails(driver: ResolvedCatalogDriver) {
  return {
    id: driver.id,
    target: driver.target,
    execution: driver.execution,
  } as const;
}

function executableArgv(argv: readonly string[]): [string, ...string[]] {
  const [executable, ...arguments_] = argv;
  return [executable, ...arguments_];
}

export async function runCapsuleDriver(
  input: RunCapsuleDriverInput): Promise<CapsuleDriverOutcome> {
  const request = createDriverPrepareRequest(input);
  const prepared = await prepareCapsuleDriver({
    projectDirectory: input.projectDirectory,
    driver: input.driver,
    request,
    untraced: input.untraced,
  });
  if (prepared.kind !== 'driver-prepared') {
    return prepared;
  }
  const propagation = prepared.propagation;
  const argv = executableArgv(prepared.command.argv);
  const secrets = executionSecrets({
    command: prepared.command,
    argv,
    targetEnvironment: request.target.environment,
  });
  let environment: Readonly<Record<string, string>>;
  try {
    environment = driverEnvironment({
      execution: input.driver.execution,
      connection: { sessionId: input.sessionId, entrypoint: input.entrypoint },
      prepared: prepared.command.environment,
      propagation,
      scope: input.scope,
    });
  } catch (error) {
    return propagationRefused({ driver: input.driver, error, secrets: secrets.diagnostic });
  }
  const process = await runPreparedCommand({
    projectDirectory: input.projectDirectory,
    sandbox: input.sandbox,
    execution: input.driver.execution,
    interaction: input.interaction,
    command: prepared.command,
    argv,
    environment,
    secrets,
  });
  return {
    kind: 'driver-completed',
    driver: driverDetails(input.driver),
    propagation,
    redaction: prepared.command.redaction,
    process,
  };
}
