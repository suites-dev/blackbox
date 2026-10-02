import type { ResolvedCatalogDriver } from '@suites/blackbox-catalog';
import type { DriverPreparation } from '@suites/blackbox-driver';
import type { SandboxHandle } from '@suites/blackbox-sandbox';

import type { CapsuleExecutionInteraction } from '../../../model/execution/interaction.js';
import type { CapsuleProcessOutcome } from '../../../model/execution/process-outcome.js';
import { runHostWithRedaction } from '../../commands.js';
import { redactValues } from '../../output/value-redaction.js';
import {
  runParticipantCaptured,
  runParticipantInteractive,
} from '../../participant/process.js';
import { isUnstartedProcess } from '../../unstarted-process.js';
import { createRedactedInteraction } from '../interactive-redaction.js';
import {
  createRedactedError,
  redactProcessMetadata,
  type executionSecrets,
} from '../secrets.js';

export interface RunPreparedCommandInput {
  readonly projectDirectory: string;
  readonly sandbox: SandboxHandle;
  readonly execution: ResolvedCatalogDriver['execution'];
  readonly interaction: CapsuleExecutionInteraction;
  readonly command: DriverPreparation;
  readonly argv: readonly [string, ...string[]];
  readonly environment: Readonly<Record<string, string>>;
  readonly secrets: ReturnType<typeof executionSecrets>;
}

function redactProcess(
  process: CapsuleProcessOutcome,
  positions: readonly number[],
  values: readonly string[],
): CapsuleProcessOutcome {
  const argv = process.argv.map((value, index) =>
    positions.includes(index) ? '[REDACTED]' : value,
  );
  return isUnstartedProcess(process)
    ? { ...process, argv, remediation: redactValues(process.remediation, values) }
    : { ...process, argv };
}

function runDriverProcess(input: {
  readonly command: RunPreparedCommandInput;
  readonly interaction: CapsuleExecutionInteraction;
  readonly secrets: readonly string[];
}): Promise<CapsuleProcessOutcome> {
  const { command, interaction, secrets } = input;
  const { argv, environment } = command;
  if (command.execution.kind === 'host') {
    return runHostWithRedaction({
      argv, cwd: command.projectDirectory, environment, interaction, secrets,
    });
  }
  const shared = { sandbox: command.sandbox, location: command.execution,
    argv, environment, secrets };
  return interaction.kind === 'interactive'
    ? runParticipantInteractive({ ...shared, interaction })
    : runParticipantCaptured({ ...shared, interaction });
}

/**
 * Runs a prepared driver command on the host or in its participant container,
 * and keeps the command's secrets out of its output, errors and metadata.
 */
export async function runPreparedCommand(
  input: RunPreparedCommandInput,
): Promise<CapsuleProcessOutcome> {
  const { command, secrets } = input;
  let process: CapsuleProcessOutcome;
  const redactedInteraction = createRedactedInteraction({
    interaction: input.interaction,
    values: secrets.retained,
  });
  const { interaction } = redactedInteraction;
  try {
    process = await runDriverProcess({
      command: input,
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
    command.redaction.preparedArgv.kind === 'positions'
      ? redactProcess(
          process,
          command.redaction.preparedArgv.positions,
          secrets.argv,
        )
      : process;
  return redactProcessMetadata({
    process: argvRedacted,
    environment: command.environment,
    redaction: command.redaction.environment,
  });
}
