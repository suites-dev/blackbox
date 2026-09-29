/**
 * Identifier shapes. The capsule pattern mirrors the Capsule package's session
 * validation (session/identity.ts generates `adjective-noun-name-<digits>`;
 * legacy records use `capsule-<uuid>`).
 */
const CAPSULE_ID =
  /^(?:[a-z]+-[a-z]+-[a-z]+(?:-[0-9]+)?|capsule-[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/u;
const TRACE_ID = /^[0-9a-f]{32}$/u;
const FULL_ACTIVITY_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const ACTIVITY_PREFIX = /^[0-9a-f-]+$/u;

export function isCapsuleIdShape(value: string): boolean {
  return CAPSULE_ID.test(value);
}

/** Exactly 32 hex characters and no hyphens is always a trace ID. */
export function isTraceId(value: string): boolean {
  return TRACE_ID.test(value);
}

export function isFullActivityId(value: string): boolean {
  return FULL_ACTIVITY_ID.test(value);
}

export function stripHyphens(value: string): string {
  return value.replaceAll('-', '');
}

/** 6 to 31 hex characters, with or without the UUID's hyphens. */
export function isActivityPrefix(value: string): boolean {
  if (!ACTIVITY_PREFIX.test(value)) {
    return false;
  }
  const hex = stripHyphens(value);
  return hex.length >= 6 && hex.length <= 31;
}
