import { startDockerContainerExecution } from './docker-engine.js';
import type {
  SandboxContainerExecutionFailure,
  SandboxContainerExecutionInput,
  SandboxContainerExecutionStartResult,
} from './types.js';
import type { SandboxContainer } from '../../types.js';

export async function startContainerExecution(input: {
  readonly request: SandboxContainerExecutionInput;
  readonly state: 'running' | 'stopping' | 'completed' | 'stop-failed';
  readonly containers: ReadonlyMap<string, SandboxContainer>;
}): Promise<SandboxContainerExecutionStartResult> {
  const failure = validate(input);
  if (failure !== undefined) {
    return { kind: 'execution-failed', failure };
  }
  const container = input.containers.get(input.request.service);
  if (container === undefined) {
    return {
      kind: 'execution-failed',
      failure: { kind: 'unknown-service', service: input.request.service },
    };
  }
  return startDockerContainerExecution({
    containerId: container.testcontainer.id,
    request: input.request,
  });
}

function validate(input: {
  readonly request: SandboxContainerExecutionInput;
  readonly state: 'running' | 'stopping' | 'completed' | 'stop-failed';
  readonly containers: ReadonlyMap<string, SandboxContainer>;
}): SandboxContainerExecutionFailure | undefined {
  if (input.request.argv.length === 0) {
    return { kind: 'invalid-argv', reason: 'empty' };
  }
  if (!input.containers.has(input.request.service)) {
    return { kind: 'unknown-service', service: input.request.service };
  }
  if (input.state !== 'running') {
    return { kind: 'sandbox-not-running', state: input.state };
  }
  const terminal = input.request.terminal;
  if (
    terminal.kind === 'tty' &&
    (!Number.isInteger(terminal.columns) ||
      terminal.columns <= 0 ||
      !Number.isInteger(terminal.rows) ||
      terminal.rows <= 0)
  ) {
    return { kind: 'invalid-terminal-size', columns: terminal.columns, rows: terminal.rows };
  }
  return undefined;
}
