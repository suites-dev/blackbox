import type { CapsuleActivityName } from './types.js';

export const CAPSULE_ACTIVITY_NAME_MAX_LENGTH = 120;

export function normalizeCapsuleActivityName(input: CapsuleActivityName): CapsuleActivityName {
  if (input.kind === 'omitted') {
    return input;
  }
  const value = input.value.trim();
  if (value.length === 0) {
    throw new Error('Capsule activity name must contain non-whitespace text');
  }
  if (Array.from(value).length > CAPSULE_ACTIVITY_NAME_MAX_LENGTH) {
    throw new Error(
      `Capsule activity name must be at most ${String(CAPSULE_ACTIVITY_NAME_MAX_LENGTH)} characters`,
    );
  }
  return { kind: 'provided', value };
}
