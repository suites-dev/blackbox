function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

function items(value: unknown): readonly unknown[] { return Array.isArray(value) ? value : []; }

/** Check the serialized checkpoint and comparison markers without exposing reader values. */
function hasFailedStateReaders(value: unknown): boolean {
  const state = record(value);
  if (state === null) { return false; }
  if (typeof state.failureCount === 'number' && state.failureCount > 0) { return true; }
  return items(state.observers).some((value) => {
    const observer = record(value);
    return observer !== null && (observer.status === 'failed' || items(observer.readers)
      .some((value) => {
        const reader = record(value);
        return reader !== null && reader.status === 'failed';
      }));
  });
}

function hasInvalidFailureCount(value: unknown): boolean {
  const state = record(value);
  if (state === null || state.version !== 1) { return false; }
  const count = state.failureCount;
  return typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0;
}

/** Terminal phase status and the final checkpoint must be retained for a complete execution. */
function hasIncompleteExecution(events: readonly Record<string, unknown>[]): boolean {
  const began = events.some((event) => event.kind === 'begin');
  const finished = events.some((event) => event.kind === 'final');
  const acted = events.some((event) => event.kind === 'action');
  return (began && (!finished || !acted)) || events.some((event) =>
    (event.kind === 'precondition' && event.status !== 'passed') ||
    (event.kind === 'action' && event.status !== 'completed'));
}

export function recordEventHealth(events: readonly Record<string, unknown>[], problems: string[]): void {
  if (events.some((event) => event.kind === 'capture-failure')) {
    problems.push('Execution capture failure was recorded');
  }
  if (events.some((event) => (event.kind === 'begin' && hasFailedStateReaders(event.initial)) ||
    (event.kind === 'final' && (hasFailedStateReaders(event.final) || hasFailedStateReaders(event.diff))))) {
    problems.push('State checkpoint or comparison records failed readers');
  }
  if (events.some((event) => (event.kind === 'begin' && hasInvalidFailureCount(event.initial)) ||
    (event.kind === 'final' && hasInvalidFailureCount(event.final)))) {
    problems.push('State checkpoint has an invalid failure count');
  }
  if (events.some((event) => (event.kind === 'begin' && record(event.initial) === null) ||
    (event.kind === 'final' && (record(event.final) === null || record(event.diff) === null)))) {
    problems.push('Execution state evidence is missing or invalid');
  }
}

export function recordExecutionHealth(events: readonly Record<string, unknown>[], problems: string[]): void {
  if (hasIncompleteExecution(events)) { problems.push('Execution did not complete successfully'); }
}
