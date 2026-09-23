import { TestcontainersComposeDriver } from './acquisition/testcontainers-driver.js';
import { SandboxRuntime } from './lifecycle/runtime.js';
import type { SandboxHandle, SandboxStartInput } from './types.js';

export {
  SandboxStartError,
  SandboxStopError,
  type CleanupOutcome,
  type RecordWriteOutcome,
  type SandboxStartFailure,
  type SandboxStopFailure,
} from './lifecycle/errors.js';
export { composeProjectName } from './lifecycle/helpers.js';
export { SandboxRuntime } from './lifecycle/runtime.js';

export function createSandboxRuntime(): SandboxRuntime {
  return new SandboxRuntime({
    driver: new TestcontainersComposeDriver(),
    now: () => new Date(),
    onEvent: () => undefined,
  });
}

export async function startSandbox(input: SandboxStartInput): Promise<SandboxHandle> {
  return createSandboxRuntime().start(input);
}
