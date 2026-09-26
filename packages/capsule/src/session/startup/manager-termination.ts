import type { ChildProcess } from 'node:child_process';

import type { CapsuleRecordedError } from '../../types.js';

export type ManagerTermination =
  | { readonly kind: 'manager-running' }
  | { readonly kind: 'manager-terminated'; readonly error: CapsuleRecordedError };

export function managerTermination(
  manager: Pick<ChildProcess, 'exitCode' | 'signalCode'>,
): ManagerTermination {
  if (manager.exitCode !== null) {
    return {
      kind: 'manager-terminated',
      error: {
        name: 'CapsuleManagerExit',
        message: `Capsule manager exited with code ${manager.exitCode}`,
      },
    };
  }
  if (manager.signalCode !== null) {
    return {
      kind: 'manager-terminated',
      error: {
        name: 'CapsuleManagerSignal',
        message: `Capsule manager was terminated by signal ${manager.signalCode}`,
      },
    };
  }
  return { kind: 'manager-running' };
}
