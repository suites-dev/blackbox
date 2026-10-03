export const progressAttachment = 'blackbox-progress';
export const attemptAttachment = 'blackbox-attempt';

export interface AttemptEvent {
  readonly schemaVersion: 1;
  readonly sequence: number;
  readonly elapsedMs: number;
  readonly phase: string;
  readonly status: 'started' | 'completed' | 'failed' | 'info';
  readonly detail: string;
  /** Sandbox that owns this event; null before the sandbox identity exists. */
  readonly sandboxId: string | null;
}

export interface AttemptProgress {
  emit(phase: string, status: AttemptEvent['status'], detail: string): void;
  protect(values: Readonly<Record<string, string>>): void;
  /** Tag every later event with the sandbox that owns it. */
  identify(sandboxId: string): void;
}

export const silentProgress = {
  emit: () => undefined,
  protect: () => undefined,
  identify: () => undefined,
} satisfies AttemptProgress;

export async function reported<Value>(
  progress: AttemptProgress,
  phase: string,
  detail: string,
  operation: () => Promise<Value>,
): Promise<Value> {
  progress.emit(phase, 'started', detail);
  try {
    const value = await operation();
    progress.emit(phase, 'completed', detail);
    return value;
  } catch (error) {
    progress.emit(phase, 'failed', `${detail}; see test error`);
    throw error;
  }
}

const eventStatuses = new Set<unknown>(['started', 'completed', 'failed', 'info']);

function hasProgressPosition(value: Readonly<Record<string, unknown>>): boolean {
  return (
    value.schemaVersion === 1 &&
    Number.isSafeInteger(value.sequence) &&
    typeof value.elapsedMs === 'number' &&
    Number.isFinite(value.elapsedMs) &&
    typeof value.phase === 'string'
  );
}

function hasProgressOutcome(value: Readonly<Record<string, unknown>>): boolean {
  return (
    eventStatuses.has(value.status) &&
    typeof value.detail === 'string' &&
    (value.sandboxId === null || typeof value.sandboxId === 'string')
  );
}

export function decodeEvent(body: Buffer): AttemptEvent | null {
  if (body.length > 16_384) {
    return null;
  }
  try {
    const value: unknown = JSON.parse(body.toString('utf8'));
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return null;
    }
    const fields = value as Readonly<Record<string, unknown>>;
    return hasProgressPosition(fields) && hasProgressOutcome(fields)
      ? (value as AttemptEvent)
      : null;
  } catch {
    return null;
  }
}
