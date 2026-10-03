export const progressAttachment = 'blackbox-progress';
export const attemptAttachment = 'blackbox-attempt';

export interface AttemptEvent {
  readonly schemaVersion: 1;
  readonly sequence: number;
  readonly elapsedMs: number;
  readonly phase: string;
  readonly status: 'started' | 'completed' | 'failed' | 'info';
  readonly detail: string;
}

export interface AttemptProgress {
  emit(phase: string, status: AttemptEvent['status'], detail: string): void;
  protect(values: Readonly<Record<string, string>>): void;
}

export const silentProgress = {
  emit: () => undefined,
  protect: () => undefined,
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

function hasValidTiming(value: object): boolean {
  return (
    'schemaVersion' in value &&
    value.schemaVersion === 1 &&
    'sequence' in value &&
    Number.isSafeInteger(value.sequence) &&
    'elapsedMs' in value &&
    typeof value.elapsedMs === 'number' &&
    Number.isFinite(value.elapsedMs)
  );
}

function hasValidDescription(value: object): boolean {
  return (
    'phase' in value &&
    typeof value.phase === 'string' &&
    'status' in value &&
    typeof value.status === 'string' &&
    ['started', 'completed', 'failed', 'info'].includes(value.status) &&
    'detail' in value &&
    typeof value.detail === 'string'
  );
}

export function decodeEvent(body: Buffer): AttemptEvent | null {
  if (body.length > 16_384) {
    return null;
  }
  try {
    const value: unknown = JSON.parse(body.toString('utf8'));
    if (typeof value !== 'object' || value === null) {
      return null;
    }
    if (!hasValidTiming(value) || !hasValidDescription(value)) {
      return null;
    }
    return value as AttemptEvent;
  } catch {
    return null;
  }
}
