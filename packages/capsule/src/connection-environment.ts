import type { CapsuleEntrypoint } from './model/environment.js';

export interface CapsuleConnectionEnvironmentInput {
  readonly sessionId: string;
  readonly entrypoint: CapsuleEntrypoint;
}

export function capsuleConnectionEnvironment(
  input: CapsuleConnectionEnvironmentInput,
): Readonly<Record<string, string>> {
  return Object.freeze({
    BLACKBOX_CAPSULE_SESSION_ID: input.sessionId,
    BLACKBOX_CAPSULE_ENTRYPOINT_URL: input.entrypoint.url,
    BLACKBOX_CAPSULE_ENTRYPOINT_HOST: input.entrypoint.host,
    BLACKBOX_CAPSULE_ENTRYPOINT_PORT: String(input.entrypoint.port),
  });
}
