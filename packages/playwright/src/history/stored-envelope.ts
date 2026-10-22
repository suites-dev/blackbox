import type { Digest } from '../envelope/index.js';
import { verifyEnvelope } from '../envelope/verify.js';
import type { AnyEnvelope } from './history-types.js';

export type StoredEnvelope =
  | { readonly ok: true; readonly envelope: AnyEnvelope }
  | { readonly ok: false; readonly problems: readonly string[] };

/** Re-verifies the bytes of a stored envelope against the identity they were stored under. */
export function checkStoredEnvelope(bytes: Buffer, id: Digest): StoredEnvelope {
  try {
    const value: unknown = JSON.parse(bytes.toString('utf8'));
    const verified = verifyEnvelope(value);
    if (!verified.ok) {
      return { ok: false, problems: verified.problems };
    }
    return (value as AnyEnvelope).digest === id
      ? { ok: true, envelope: value as AnyEnvelope }
      : { ok: false, problems: ['stored under a different identity'] };
  } catch {
    return { ok: false, problems: ['stored bytes are not an envelope'] };
  }
}
