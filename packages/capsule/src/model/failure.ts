import type { CapsuleRecordedError } from './recorded-error.js';
import type { CapsuleSessionState } from './session-state.js';

export type CapsuleOperationFailure =
  | {
      readonly kind: 'capsule-not-found';
      readonly sessionId: string;
      readonly message: string;
    }
  | {
      readonly kind: 'capsule-invalid-state';
      readonly sessionId: string;
      readonly state: CapsuleSessionState;
      readonly message: string;
    }
  | {
      readonly kind: 'capsule-operation-failed';
      readonly operation: 'start' | 'exec' | 'stop' | 'report' | 'observations';
      readonly sessionId: string;
      readonly error: CapsuleRecordedError;
    };
