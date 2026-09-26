import type { ResolvedCatalogDriver } from '@suites/blackbox-catalog-internal';
import type { DriverPreparation } from '@suites/blackbox-driver';
import type { SandboxHandle } from '@suites/blackbox-sandbox-internal';
import type {
  TelemetryExecutionScope,
  TelemetryPropagationRecord,
} from '@suites/blackbox-telemetry-internal';

import { capsuleConnectionEnvironment } from '../connection-environment.js';
import type {
  CapsuleEntrypoint,
  CapsuleDriverOutcome,
  CapsuleExecutionInteraction,
  CapsuleProcessOutcome,
} from '../types.js';
import { runHostWithRedaction } from './commands.js';
import { prepareCapsuleDriver } from './driver/preparation.js';
import { executionEnvironment, failedPropagation } from './driver/propagation.js';
import { createDriverPrepareRequest } from './driver/request.js';
import { createRedactedInteraction } from './driver/interactive-redaction.js';
import {
  createRedactedError,
  redactProcessMetadata,
  selectedArgvValues,
  selectedValues,
} from './driver/secrets.js';
import {
  runParticipantCaptured,
  runParticipantInteractive,
} from './participant/process.js';
import { redactValues } from './output/value-redaction.js';

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

function executionSecrets(input: {
  readonly command: DriverPreparation;
  readonly argv: readonly string[];
  readonly targetEnvironment: Readonly<Record<string, string>>;
}) {
  const argv = selectedArgvValues({
    argv: input.argv,
    selection: input.command.redaction.preparedArgv,
  });
  const environment = input.command.redaction.environment.kind === 'none'
    ? []
    : selectedValues({
        environment: input.command.environment,
        selection: input.command.redaction.environment,
      });
  return {
    argv,
    retained: [...new Set([...environment, ...argv])]
      .sort((left, right) => right.length - left.length),
    diagnostic: [
      ...Object.values(input.targetEnvironment),
      ...Object.values(input.command.environment),
      ...argv,
    ],
  } as const;
}

function driverEnvironment(input: {
  readonly request: RunCapsuleDriverInput;
  readonly command: DriverPreparation;
  readonly propagation: TelemetryPropagationRecord;
}): Readonly<Record<string, string>> {
  return executionEnvironment({
    base: input.request.driver.execution.kind === 'host'
      ? capsuleConnectionEnvironment({
          sessionId: input.request.sessionId,
          entrypoint: input.request.entrypoint,
        })
      : {},
    prepared: input.command.environment,
    propagation: input.propagation,
    scope: input.request.scope,
  });
}

function redactProcess(
  process: CapsuleProcessOutcome,
  positions: readonly number[],
  values: readonly string[],
): CapsuleProcessOutcome {
  const argv = process.argv.map((value, index) =>
    positions.includes(index) ? '[REDACTED]' : value,
  );
  return process.kind === 'executable-not-found'
    ? { ...process, argv, remediation: redactValues(process.remediation, values) }
    : { ...process, argv };
}

function runDriverProcess(input: {
  readonly driverInput: RunCapsuleDriverInput;
  readonly argv: readonly [string, ...string[]];
  readonly environment: Readonly<Record<string, string>>;
  readonly interaction: CapsuleExecutionInteraction;
  readonly secrets: readonly string[];
}): Promise<CapsuleProcessOutcome> {
  const { driverInput, argv, environment, interaction, secrets } = input;
  if (driverInput.driver.execution.kind === 'host') {
    return runHostWithRedaction({
      argv, cwd: driverInput.projectDirectory, environment, interaction, secrets,
    });
  }
  const shared = { sandbox: driverInput.sandbox, location: driverInput.driver.execution,
    argv, environment, secrets };
  return interaction.kind === 'interactive'
    ? runParticipantInteractive({ ...shared, interaction })
    : runParticipantCaptured({ ...shared, interaction });
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
      request: input,
      command: prepared.command,
      propagation,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      kind: 'driver-propagation-refused',
      driverId: input.driver.id,
      propagation: failedPropagation(
        input.driver.propagation,
        redactValues(message, secrets.diagnostic),
      ),
    };
  }
  let process: CapsuleProcessOutcome;
  const redactedInteraction = createRedactedInteraction({
    interaction: input.interaction,
    values: secrets.retained,
  });
  const { interaction } = redactedInteraction;
  try {
    process = await runDriverProcess({
      driverInput: input,
      argv,
      environment,
      interaction,
      secrets: secrets.retained,
    });
  } catch (error) {
    throw createRedactedError({
      error,
      values: secrets.diagnostic,
    });
  } finally {
    await redactedInteraction.finish();
  }
  const argvRedacted =
    prepared.command.redaction.preparedArgv.kind === 'positions'
      ? redactProcess(
          process,
          prepared.command.redaction.preparedArgv.positions,
          secrets.argv,
        )
      : process;
  const redacted = redactProcessMetadata({
    process: argvRedacted,
    environment: prepared.command.environment,
    redaction: prepared.command.redaction.environment,
  });
  return {
    kind: 'driver-completed',
    driver: driverDetails(input.driver),
    propagation,
    redaction: prepared.command.redaction,
    process: redacted,
  };
}
