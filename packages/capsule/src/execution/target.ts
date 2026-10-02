import type { ResolvedCatalogDriver } from '@suites/blackbox-catalog';
import { createTelemetryPropagationRecord } from '@suites/blackbox-telemetry';

import { capsuleConnectionEnvironment } from '../connection-environment.js';
import type { CapsuleExecTarget } from '../model/operations.js';
import type { CapsuleExecutionOutcome } from '../model/outcome.js';
import { runHostWithInteraction } from './commands.js';
import { runCapsuleDriver, type RunCapsuleDriverInput } from './driver-execution.js';

export interface ExecuteCapsuleTargetInput
  extends Omit<RunCapsuleDriverInput, 'driver' | 'argv' | 'untraced'> {
  readonly target: CapsuleExecTarget;
  readonly drivers: Readonly<Record<string, ResolvedCatalogDriver>>;
}

/** Runs one exec target: a raw host command, or a catalog driver by id. */
export async function executeCapsuleTarget(
  input: ExecuteCapsuleTargetInput,
): Promise<CapsuleExecutionOutcome> {
  const { target, drivers, ...context } = input;
  if (target.kind === 'host') {
    const process = await runHostWithInteraction({
      argv: target.argv,
      cwd: context.projectDirectory,
      environment: capsuleConnectionEnvironment({
        sessionId: context.sessionId,
        entrypoint: context.entrypoint,
      }),
      interaction: context.interaction,
    });
    return {
      ...process,
      propagation: createTelemetryPropagationRecord({
        expectation: { kind: 'propagation-not-requested' },
        outcome: { kind: 'context-not-injected', reason: 'raw-command' },
      }),
    };
  }
  if (!Object.hasOwn(drivers, target.driverId)) {
    throw new Error(`Unknown driver ${JSON.stringify(target.driverId)}`);
  }
  return runCapsuleDriver({
    ...context,
    driver: drivers[target.driverId],
    argv: target.argv,
    untraced: target.untraced,
  });
}
