import { randomUUID } from 'node:crypto';
import type { Socket } from 'node:net';

import {
  createTelemetryPropagationRecord,
  createTelemetryExecutionScope,
  type TelemetryScopeResult,
} from '@suites/blackbox-telemetry-internal';
import type { DriverArgvRedaction } from '@suites/blackbox-driver';

import { capsuleConnectionEnvironment } from '../connection-environment.js';
import { normalizeCapsuleActivityName } from '../execution/activity-name.js';
import { runHostWithInteraction } from '../execution/commands.js';
import { runCapsuleDriver } from '../execution/driver-execution.js';
import {
  exportActivityRootSpan,
  type RootSpanExportResult,
} from '../execution/root-span.js';
import { sendResponse } from '../ipc/server.js';
import type { CapsuleManagerBootstrap, CapsuleManagerRequest } from '../protocol.js';
import { recordedError, writeCapsuleActivities } from '../records.js';
import type {
  CapsuleActivityReport,
  CapsuleExecutionInteraction,
  CapsuleExecutionOutcome,
} from '../types.js';
import type { RunningManager } from './runtime.js';

interface HandleExecInput {
  readonly socket: Socket;
  readonly request: Extract<
    CapsuleManagerRequest,
    { readonly kind: 'exec-request' | 'interactive-exec-request' }
  >;
  readonly bootstrap: CapsuleManagerBootstrap;
  readonly manager: RunningManager;
  readonly interaction: CapsuleExecutionInteraction;
}

interface ExecutionContext {
  readonly input: HandleExecInput;
  readonly activityId: string;
  readonly scope: ReturnType<typeof createTelemetryExecutionScope>;
  readonly admitted: Extract<CapsuleActivityReport, { readonly kind: 'running' }>;
}

async function executeTarget(input: ExecutionContext): Promise<CapsuleExecutionOutcome> {
  const { target } = input.input.request;
  if (target.kind === 'host') {
    const process = await runHostWithInteraction({
      argv: target.argv,
      cwd: input.input.bootstrap.projectDirectory,
      environment: capsuleConnectionEnvironment({
        sessionId: input.input.bootstrap.sessionId,
        entrypoint: input.input.manager.entrypoint,
      }),
      interaction: input.input.interaction,
    });
    return {
      ...process,
      propagation: createTelemetryPropagationRecord({
        expectation: { kind: 'propagation-not-requested' },
        outcome: { kind: 'context-not-injected', reason: 'raw-command' },
      }),
    };
  }
  if (!Object.hasOwn(input.input.manager.drivers, target.driverId)) {
    throw new Error(`Unknown driver ${JSON.stringify(target.driverId)}`);
  }
  return runCapsuleDriver({
    projectDirectory: input.input.bootstrap.projectDirectory,
    sessionId: input.input.bootstrap.sessionId,
    activityId: input.activityId,
    entrypoint: input.input.manager.entrypoint,
    driver: input.input.manager.drivers[target.driverId],
    argv: target.argv,
    untraced: target.untraced,
    sandbox: input.input.manager.sandbox,
    scope: input.scope,
    interaction: input.input.interaction,
  });
}

function outcomeResult(outcome: CapsuleExecutionOutcome): TelemetryScopeResult {
  const process = outcome.kind === 'driver-completed' ? outcome.process : outcome;
  return process.kind === 'exited' && process.exitCode === 0
    ? { kind: 'telemetry-scope-succeeded' }
    : {
        kind: 'telemetry-scope-failed',
        message: `Activity completed with ${outcome.kind}`,
      };
}

async function persistActivity(
  context: ExecutionContext,
  activity: CapsuleActivityReport,
): Promise<void> {
  const { input } = context;
  input.manager.activities = [...input.manager.activities.slice(0, -1), activity];
  await writeCapsuleActivities({
    projectDirectory: input.bootstrap.projectDirectory,
    sessionId: input.bootstrap.sessionId,
    activities: input.manager.activities,
  });
}

async function exportRoot(
  context: ExecutionContext,
  result: TelemetryScopeResult,
): Promise<TelemetryScopeResult> {
  const { input } = context;
  const exported: RootSpanExportResult = await exportActivityRootSpan({
    sandbox: input.manager.sandbox,
    authorizationToken: input.manager.telemetryAuthorization.ingestToken,
    sessionId: input.bootstrap.sessionId,
    activityId: context.activityId,
    purpose: input.request.purpose,
    scope: context.scope.active,
    result,
  });
  return exported.kind === 'root-span-exported'
    ? result
    : { kind: 'telemetry-scope-failed', message: exported.message };
}

async function recordFailedExecution(
  context: ExecutionContext,
  error: unknown,
): Promise<void> {
  const failure = recordedError(error);
  const result = {
    kind: 'telemetry-scope-failed',
    message: failure.message,
  } satisfies TelemetryScopeResult;
  await persistActivity(context, {
    ...context.admitted,
    kind: 'failed',
    telemetry: context.scope.complete(await exportRoot(context, result)),
    error: failure,
    completedAt: new Date().toISOString(),
  });
}

async function recordCompletedExecution(
  context: ExecutionContext,
  outcome: CapsuleExecutionOutcome,
): Promise<void> {
  const result = outcomeResult(outcome);
  await persistActivity(context, {
    ...context.admitted,
    argv: completedActivityArgv(context, outcome),
    kind: 'completed',
    telemetry: context.scope.complete(await exportRoot(context, result)),
    outcome,
    completedAt: new Date().toISOString(),
  });
}

function applyArgvRedaction(
  argv: readonly string[],
  redaction: DriverArgvRedaction,
): readonly string[] {
  return redaction.kind === 'none'
    ? [...argv]
    : argv.map((value, index) => (redaction.positions.includes(index) ? '[REDACTED]' : value));
}

function completedActivityArgv(
  context: ExecutionContext,
  outcome: CapsuleExecutionOutcome,
): readonly string[] {
  const target = context.input.request.target;
  return target.kind === 'driver' && outcome.kind === 'driver-completed'
    ? applyArgvRedaction(target.argv, outcome.redaction.requestArgv)
    : context.admitted.argv;
}

function admittedArgv(request: HandleExecInput['request']): readonly string[] {
  const { target } = request;
  return target.kind === 'host'
    ? [...target.argv]
    : target.argv.map((value, index) => (index === 0 ? value : '[REDACTED]'));
}

function executionContext(input: HandleExecInput): ExecutionContext {
  const activityId = randomUUID();
  const target = input.request.target;
  const scope = createTelemetryExecutionScope({
    executionId: activityId,
    operationName: `capsule.${target.kind}`,
  });
  const admitted = {
    kind: 'running',
    activityId,
    sequence: input.manager.activities.length + 1,
    name: normalizeCapsuleActivityName(input.request.name),
    purpose: input.request.purpose,
    target:
      target.kind === 'driver'
        ? { kind: 'driver' as const, driverId: target.driverId }
        : { kind: 'host' as const },
    argv: admittedArgv(input.request),
    startedAt: new Date().toISOString(),
    telemetry: scope.active,
  } satisfies CapsuleActivityReport;
  return { input, activityId, scope, admitted };
}

export async function handleExec(input: HandleExecInput): Promise<void> {
  if (input.manager.record.state !== 'running') {
    throw new Error(`Cannot execute against Capsule in ${input.manager.record.state} state`);
  }
  const context = executionContext(input);
  input.manager.activities = [...input.manager.activities, context.admitted];
  await writeCapsuleActivities({
    projectDirectory: input.bootstrap.projectDirectory,
    sessionId: input.bootstrap.sessionId,
    activities: input.manager.activities,
  });
  let outcome: CapsuleExecutionOutcome;
  try {
    outcome = await executeTarget(context);
  } catch (error) {
    await recordFailedExecution(context, error);
    throw error;
  }
  await recordCompletedExecution(context, outcome);
  await sendResponse(input.socket, {
    kind: 'exec-response',
    requestId: input.request.requestId,
    activityId: context.activityId,
    outcome,
  });
}
