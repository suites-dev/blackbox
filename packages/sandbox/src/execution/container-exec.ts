import { asError } from '../lifecycle/errors.js';
import type {
  SandboxContainer,
  SandboxExecuteInput,
  SandboxExecuteResult,
  SandboxExecutionOutput,
  StartedComposeSandbox,
} from '../types.js';

export async function executeInSandbox(input: {
  readonly request: SandboxExecuteInput;
  readonly state: 'running' | 'stopping' | 'completed' | 'stop-failed';
  readonly containers: ReadonlyMap<string, SandboxContainer>;
  readonly compose: StartedComposeSandbox;
}): Promise<SandboxExecuteResult> {
  const { request } = input;
  if (request.argv.length === 0) {
    return { kind: 'execution-failed', failure: { kind: 'invalid-argv', reason: 'empty' } };
  }
  if (!input.containers.has(request.service)) {
    return {
      kind: 'execution-failed',
      failure: { kind: 'unknown-service', service: request.service },
    };
  }
  if (input.state !== 'running') {
    return {
      kind: 'execution-failed',
      failure: { kind: 'sandbox-not-running', state: input.state },
    };
  }
  try {
    const result = await input.compose.execute(request);
    return { kind: 'exited', service: request.service, ...result };
  } catch (cause) {
    const error = asError(cause);
    return {
      kind: 'execution-failed',
      failure: {
        kind: 'runtime-error',
        error: { name: error.name, message: error.message },
        output: executionErrorOutput(cause),
      },
    };
  }
}

function executionErrorOutput(cause: unknown): SandboxExecutionOutput {
  if (typeof cause !== 'object' || cause === null) {
    return { kind: 'unavailable' };
  }
  const stdout = 'stdout' in cause && typeof cause.stdout === 'string' ? cause.stdout : '';
  const stderr = 'stderr' in cause && typeof cause.stderr === 'string' ? cause.stderr : '';
  const combined = 'output' in cause && typeof cause.output === 'string' ? cause.output : '';
  if (stdout.length === 0 && stderr.length === 0 && combined.length === 0) {
    return { kind: 'unavailable' };
  }
  return { kind: 'captured', stdout, stderr, combined };
}
