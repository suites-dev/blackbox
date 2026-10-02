export interface CapsuleRecordedError {
  readonly name: string;
  readonly message: string;
}

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

export type CapsuleSessionState =
  | 'admitted'
  | 'manager-starting'
  | 'sandbox-starting'
  | 'running'
  | 'stopping'
  | 'stopped'
  | 'start-failed'
  | 'stop-failed'
  | 'manager-failed';
