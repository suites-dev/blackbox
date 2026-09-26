import type {
  SandboxContainerControlResult,
  SandboxContainerExecution,
} from '@suites/blackbox-sandbox-internal';

import type { CapsuleExecutionControl, CapsuleExecutionInteraction } from '../types.js';

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

function cancelledInputControl(
  control: Extract<CapsuleExecutionControl, { readonly kind: 'stdin-chunk' | 'stdin-end' }>,
): SandboxContainerControlResult {
  return {
    kind: 'failed',
    action: control.kind,
    error: { name: 'AbortError', message: 'Participant stdin operation was cancelled.' },
  };
}

async function abortableParticipantControl(input: {
  readonly execution: SandboxContainerExecution;
  readonly interaction: CapsuleExecutionInteraction;
  readonly control: CapsuleExecutionControl;
}): Promise<SandboxContainerControlResult> {
  const { cancellation } = input.interaction;
  const { control } = input;
  if (
    cancellation.kind === 'not-cancellable' ||
    (control.kind !== 'stdin-chunk' && control.kind !== 'stdin-end')
  ) {
    return await participantControl(input.execution, control);
  }
  const operation = participantControl(input.execution, control);
  if (cancellation.signal.aborted) {
    await input.execution.forceTerminate();
    return cancelledInputControl(control);
  }
  return await new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = (): boolean => {
      if (settled) {
        return false;
      }
      settled = true;
      cancellation.signal.removeEventListener('abort', abort);
      return true;
    };
    const finish = (result: SandboxContainerControlResult): void => {
      if (cleanup()) {
        resolve(result);
      }
    };
    const fail = (error: unknown): void => {
      if (cleanup()) {
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    };
    const abort = (): void => {
      void input.execution.forceTerminate().then(() => {
        finish(cancelledInputControl(control));
      }, fail);
    };
    cancellation.signal.addEventListener('abort', abort, { once: true });
    void operation.then(finish, fail);
  });
}

export async function pumpParticipantControls(input: {
  readonly execution: SandboxContainerExecution;
  readonly interaction: CapsuleExecutionInteraction;
}): Promise<void> {
  for await (const control of input.interaction.controls) {
    const result = await abortableParticipantControl({ ...input, control });
    if (input.interaction.kind === 'interactive') {
      await input.interaction
        .onEvent({ kind: 'control-result', controlId: control.controlId, result })
        .catch(() => undefined);
    }
  }
}
