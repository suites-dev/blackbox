import type { CapsuleCleanupReport, CapsuleRecordedError, CapsuleSessionState } from '../types.js';

export interface CapsuleRegistryInput {
  readonly projectDirectory: string;
}

export interface CapsuleSessionSummary {
  readonly sessionId: string;
  readonly system: string;
  readonly title: string;
  readonly description: string | undefined;
  readonly state: CapsuleSessionState;
  readonly admittedAt: string;
  readonly updatedAt: string;
  readonly artifactRoot: string;
  readonly cleanup: CapsuleCleanupReport['kind'];
}

export type CapsuleRegistryEntry =
  | { readonly kind: 'capsule-session-summary'; readonly summary: CapsuleSessionSummary }
  | {
      readonly kind: 'capsule-session-corrupt';
      readonly directoryName: string;
      readonly failure:
        | { readonly kind: 'record-missing'; readonly error: CapsuleRecordedError }
        | { readonly kind: 'record-corrupt'; readonly error: CapsuleRecordedError }
        | {
            readonly kind: 'identity-mismatch';
            readonly directorySessionId: string;
            readonly recordSessionId: string;
          };
    };

export type CapsuleRegistryResult =
  | {
      readonly kind: 'capsule-session-registry';
      readonly projectDirectory: string;
      readonly entries: readonly CapsuleRegistryEntry[];
    }
  | { readonly kind: 'capsule-registry-failed'; readonly error: CapsuleRecordedError };
