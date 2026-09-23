import { SandboxStartError, SandboxStopError } from '../lifecycle/errors.js';

export function diagnosticError(input: {
  readonly primary: unknown;
  readonly cleanup: readonly unknown[];
}): AggregateError {
  const primary = asError(input.primary);
  const cleanup = input.cleanup.map(asError);
  return new AggregateError(
    [primary, ...cleanup],
    `Docker concurrency proof failed; primary=${errorDetail(primary)}; cleanup=${cleanup.map(errorDetail).join(' | ')}`,
  );
}

function errorDetail(error: Error): string {
  if (error instanceof SandboxStartError) {
    return `${error.message} [cleanup=${error.failure.cleanup.kind}; record=${error.failure.record.kind}]`;
  }
  if (!(error instanceof SandboxStopError)) {
    return error.message;
  }
  switch (error.failure.kind) {
    case 'cleanup-failed':
      return `${error.message} [cleanup=${error.failure.cleanupError.message}; record=${error.failure.record.kind}]`;
    case 'record-failed':
      return `${error.message} [record=${error.failure.recordError.message}]`;
  }
}

function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}
