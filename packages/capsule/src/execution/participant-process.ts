import type {
  SandboxContainerControlResult,
  SandboxContainerExecution,
  SandboxContainerExecutionFailure,
  SandboxHandle,
} from '@suites/blackbox-sandbox-internal';

import type {
  CapsuleExecutionControl,
  CapsuleExecutionInteraction,
  CapsuleExecutionLocation,
  CapsuleProcessOutcome,
} from './types.js';
import {
  createOutputRetention,
  retainedOutputMetadata,
  retainedOutputText,
} from './output-retention.js';

function failedExecution(input: {
  readonly failure: SandboxContainerExecutionFailure;
  readonly argv: readonly string[];
  readonly location: CapsuleExecutionLocation;
}): CapsuleProcessOutcome {
  if (input.failure.kind === 'executable-not-found') {
    return {
      kind: 'executable-not-found',
      argv: input.argv,
      location: input.location,
      remediation: `Install ${JSON.stringify(input.failure.executable)} in participant ${JSON.stringify(input.location.kind === 'participant' ? input.location.participantId : '')} or use a host-executed driver.`,
    };
  }
  throw new Error(`Participant execution failed: ${JSON.stringify(input.failure)}`);
}

export async function runParticipantCaptured(input: {
  readonly sandbox: SandboxHandle;
  readonly location: Extract<CapsuleExecutionLocation, { readonly kind: 'participant' }>;
  readonly argv: readonly [string, ...string[]];
  readonly environment: Readonly<Record<string, string>>;
  readonly interaction: Extract<CapsuleExecutionInteraction, { readonly kind: 'captured' }>;
  readonly secrets: readonly string[];
}): Promise<CapsuleProcessOutcome> {
  const stdout = createOutputRetention({ secrets: input.secrets });
  const stderr = createOutputRetention({ secrets: input.secrets });
  const started = await input.sandbox.startContainerExecution({
    kind: 'container-stream-exec',
    service: input.location.service,
    argv: input.argv,
    environment: input.environment,
    terminal: { kind: 'captured' },
    onOutput: (event) => {
      const chunk = Buffer.from(event.chunk);
      if (event.kind === 'stdout') {
        stdout.append(chunk);
      } else {
        stderr.append(chunk);
      }
      return Promise.resolve();
    },
  });
  if (started.kind === 'execution-failed') {
    return failedExecution({
      failure: started.failure,
      argv: input.argv,
      location: input.location,
    });
  }
  void pumpControls({ execution: started.execution, interaction: input.interaction }).catch(
    () => undefined,
  );
  await started.execution.endStdin();
  const completed = await started.execution.completion;
  if (completed.kind === 'execution-failed') {
    return failedExecution({
      failure: completed.failure,
      argv: input.argv,
      location: input.location,
    });
  }
  const retainedStdout = stdout.finish();
  const retainedStderr = stderr.finish();
  return {
    kind: 'exited',
    argv: input.argv,
    location: input.location,
    exitCode: completed.exitCode,
    stdout: retainedOutputText(retainedStdout),
    stderr: retainedOutputText(retainedStderr),
    retention: {
      stdout: retainedOutputMetadata(retainedStdout),
      stderr: retainedOutputMetadata(retainedStderr),
    },
  };
}

async function participantControl(
  execution: SandboxContainerExecution,
  control: CapsuleExecutionControl,
): Promise<SandboxContainerControlResult> {
  switch (control.kind) {
    case 'stdin-chunk':
      return execution.writeStdin({ kind: 'stdin-chunk', chunk: control.chunk });
    case 'stdin-end':
      return execution.endStdin();
    case 'resize':
      return execution.resize(control.size);
    case 'signal':
      return execution.signal({ signal: control.signal });
    case 'force-terminate':
      return execution.forceTerminate();
  }
}

async function pumpControls(input: {
  readonly execution: SandboxContainerExecution;
  readonly interaction: CapsuleExecutionInteraction;
}): Promise<void> {
  for await (const control of input.interaction.controls) {
    const result = await participantControl(input.execution, control);
    if (input.interaction.kind === 'interactive') {
      await input.interaction
        .onEvent({ kind: 'control-result', controlId: control.controlId, result })
        .catch(() => undefined);
    }
  }
}

function completedOutcome(input: {
  readonly argv: readonly string[];
  readonly location: Extract<CapsuleExecutionLocation, { readonly kind: 'participant' }>;
  readonly exitCode: number;
  readonly stdout: ReturnType<typeof createOutputRetention>;
  readonly stderr: ReturnType<typeof createOutputRetention>;
}): CapsuleProcessOutcome {
  const retainedStdout = input.stdout.finish();
  const retainedStderr = input.stderr.finish();
  return {
    kind: 'exited',
    argv: input.argv,
    location: input.location,
    exitCode: input.exitCode,
    stdout: retainedOutputText(retainedStdout),
    stderr: retainedOutputText(retainedStderr),
    retention: {
      stdout: retainedOutputMetadata(retainedStdout),
      stderr: retainedOutputMetadata(retainedStderr),
    },
  };
}

export async function runParticipantInteractive(input: {
  readonly sandbox: SandboxHandle;
  readonly location: Extract<CapsuleExecutionLocation, { readonly kind: 'participant' }>;
  readonly argv: readonly [string, ...string[]];
  readonly environment: Readonly<Record<string, string>>;
  readonly interaction: Extract<CapsuleExecutionInteraction, { readonly kind: 'interactive' }>;
  readonly secrets: readonly string[];
}): Promise<CapsuleProcessOutcome> {
  const stdout = createOutputRetention({ secrets: input.secrets });
  const stderr = createOutputRetention({ secrets: input.secrets });
  const started = await input.sandbox.startContainerExecution({
    kind: 'container-stream-exec',
    service: input.location.service,
    argv: input.argv,
    environment: input.environment,
    terminal: { kind: 'tty', ...input.interaction.terminal },
    onOutput: async (event) => {
      const chunk = Buffer.from(event.chunk);
      const stream = event.kind === 'stderr' ? 'stderr' : 'terminal';
      (event.kind === 'stderr' ? stderr : stdout).append(chunk);
      await input.interaction.onEvent({ kind: 'output', stream, chunk });
    },
  });
  if (started.kind === 'execution-failed') {
    return failedExecution({
      failure: started.failure,
      argv: input.argv,
      location: input.location,
    });
  }
  void pumpControls({ execution: started.execution, interaction: input.interaction }).catch(
    () => undefined,
  );
  const completed = await started.execution.completion;
  if (completed.kind === 'execution-failed') {
    return failedExecution({
      failure: completed.failure,
      argv: input.argv,
      location: input.location,
    });
  }
  return completedOutcome({
    argv: input.argv,
    location: input.location,
    exitCode: completed.exitCode,
    stdout,
    stderr,
  });
}
