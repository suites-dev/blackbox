import { digestOf, type Digest } from '../../envelope/index.js';

/** A final runner observation, separate from the earlier fixture receipt and envelope. */
export interface NativeResult {
  readonly kind: 'playwright-result';
  readonly version: 1;
  readonly digest: Digest;
  readonly envelope: Digest;
  readonly attemptId: string;
  readonly status: 'passed' | 'failed' | 'timedOut' | 'skipped' | 'interrupted';
}

export function nativeResult(body: Omit<NativeResult, 'digest'>): NativeResult {
  return { ...body, digest: digestOf(body) };
}

export function verifyNativeResult(value: unknown): { ok: boolean; problems: string[] } {
  if (value === null || typeof value !== 'object') { return { ok: false, problems: ['not an object'] }; }
  const row = value as Record<string, unknown>;
  if (row.kind !== 'playwright-result' || row.version !== 1 || typeof row.attemptId !== 'string' || row.attemptId.length === 0 ||
      typeof row.envelope !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(row.envelope) ||
      !['passed', 'failed', 'timedOut', 'skipped', 'interrupted'].includes(String(row.status)) || typeof row.digest !== 'string') {
    return { ok: false, problems: ['invalid Playwright result'] };
  }
  const { digest, ...body } = row;
  return digest === digestOf(body) ? { ok: true, problems: [] } : { ok: false, problems: ['digest'] };
}
