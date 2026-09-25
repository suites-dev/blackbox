import type { ResolvedCatalogDriver } from '@suites/blackbox-catalog-internal';
import type { SandboxHandle } from '@suites/blackbox-sandbox-internal';
import type { TelemetryExecutionScope } from '@suites/blackbox-telemetry-internal';

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
  selectedValues,
} from './driver/secrets.js';
import {
  runParticipantCaptured,
  runParticipantInteractive,
} from './participant-process.js';
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

function redactProcess(
  process: CapsuleProcessOutcome,
  positions: readonly number[],
): CapsuleProcessOutcome {
  const argv = process.argv.map((value, index) =>
    positions.includes(index) ? '[REDACTED]' : value,
  );
  return { ...process, argv };
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
    : runParticipantCaptured(shared);
}

export async function runCapsuleDriver(
  input: RunCapsuleDriverInput,
): Promise<CapsuleDriverOutcome> {
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
  const secretValues = [...Object.values(request.target.environment), ...Object.values(prepared.command.environment)];
  const argv = executableArgv(prepared.command.argv);
  const baseEnvironment = capsuleConnectionEnvironment({
    sessionId: input.sessionId,
    entrypoint: input.entrypoint,
  });
  let environment: Readonly<Record<string, string>>;
  try {
    environment = executionEnvironment({
      base: input.driver.execution.kind === 'host' ? baseEnvironment : {},
      prepared: prepared.command.environment,
      propagation,
      scope: input.scope,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      kind: 'driver-propagation-refused',
      driverId: input.driver.id,
      propagation: failedPropagation(input.driver.propagation, redactValues(message, secretValues)),
    };
  }
  let process: CapsuleProcessOutcome;
  const redactedInteraction = createRedactedInteraction({
    interaction: input.interaction,
    environment: prepared.command.environment,
    redaction: prepared.command.redaction.environment,
  });
  const { interaction } = redactedInteraction;
  const selection = prepared.command.redaction.environment;
  const secrets = selection.kind === 'none' ? []
    : selectedValues({ environment: prepared.command.environment, selection });
  try {
    process = await runDriverProcess({ driverInput: input, argv, environment, interaction, secrets });
  } catch (error) {
    throw createRedactedError({
      error,
      values: secretValues,
    });
  } finally {
    redactedInteraction.finish();
  }
  const argvRedacted =
    prepared.command.redaction.preparedArgv.kind === 'positions'
      ? redactProcess(process, prepared.command.redaction.preparedArgv.positions)
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
