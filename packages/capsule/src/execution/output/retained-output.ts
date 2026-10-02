export type RetainedOutput =
  | {
      readonly kind: 'complete';
      readonly text: string;
      readonly originalBytes: number;
    }
  | {
      readonly kind: 'truncated';
      readonly head: string;
      readonly tail: string;
      readonly originalBytes: number;
      readonly retainedBytes: number;
      readonly omittedBytes: number;
    };
