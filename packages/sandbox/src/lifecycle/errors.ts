export type CleanupOutcome =
  | { readonly kind: 'not-attempted' }
  | { readonly kind: 'complete' }
  | { readonly kind: 'failed'; readonly error: Error };

export type RecordWriteOutcome =
  | { readonly kind: 'written' }
  | { readonly kind: 'failed'; readonly error: Error };

export interface SandboxStartFailure {
  readonly kind: 'start-failed';
  readonly startupError: Error;
  readonly cleanup: CleanupOutcome;
  readonly record: RecordWriteOutcome;
}

export class SandboxStartError extends Error {
  readonly failure: SandboxStartFailure;

  constructor(input: { readonly failure: SandboxStartFailure }) {
    super('Sandbox startup failed', { cause: input.failure.startupError });
    this.name = 'SandboxStartError';
    this.failure = input.failure;
  }
}

export type SandboxStopFailure =
  | {
      readonly kind: 'cleanup-failed';
      readonly cleanupError: Error;
      readonly record: RecordWriteOutcome;
    }
  | { readonly kind: 'record-failed'; readonly recordError: Error };

export class SandboxStopError extends Error {
  readonly failure: SandboxStopFailure;

  constructor(input: { readonly failure: SandboxStopFailure }) {
    const recordFailed = input.failure.kind === 'record-failed';
    super(
      recordFailed ? 'Sandbox terminal record could not be written' : 'Sandbox cleanup failed',
      {
        cause: recordFailed ? input.failure.recordError : input.failure.cleanupError,
      },
    );
    this.name = 'SandboxStopError';
    this.failure = input.failure;
  }
}

export function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
