export type CapsuleExecutionLocation =
  | { readonly kind: 'host' }
  | {
      readonly kind: 'participant';
      readonly participantId: string;
      readonly service: string;
    };

export type CapsuleOutputRetention =
  | { readonly kind: 'complete'; readonly originalBytes: number }
  | {
      readonly kind: 'truncated';
      readonly originalBytes: number;
      readonly retainedBytes: number;
      readonly omittedBytes: number;
      readonly retained: 'head-and-tail';
    };

interface CapsuleProcessFields {
  readonly argv: readonly string[];
  readonly location: CapsuleExecutionLocation;
  readonly stdout: string;
  readonly stderr: string;
  readonly retention: {
    readonly stdout: CapsuleOutputRetention;
    readonly stderr: CapsuleOutputRetention;
  };
}

export type CapsuleProcessOutcome =
  | (CapsuleProcessFields & { readonly kind: 'exited'; readonly exitCode: number })
  | (CapsuleProcessFields & { readonly kind: 'signaled'; readonly signal: NodeJS.Signals })
  | {
      readonly kind: 'executable-not-found';
      readonly argv: readonly string[];
      readonly location: CapsuleExecutionLocation;
      readonly remediation: string;
    }
  | {
      /** The host refused to execute the file (EACCES or EPERM); no process ran. */
      readonly kind: 'not-executable';
      readonly argv: readonly string[];
      readonly location: CapsuleExecutionLocation;
      readonly remediation: string;
    };
