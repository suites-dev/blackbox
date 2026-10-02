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
