/** A setup command that ran inside a participant during this attempt. */
export interface BlackboxActivity {
  readonly activityId: string;
  readonly purpose: 'setup';
  readonly participant: string;
  readonly argv: readonly [string, ...string[]];
  /** Trace of the activity; instrumented processes it starts join it. */
  readonly traceId: string;
  readonly traceparent: string;
  readonly exitCode: number;
  /** Captured output, at most 1 MiB per stream. */
  readonly stdout: string;
  readonly stderr: string;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly rootSpan:
    | { readonly kind: 'root-span-exported' }
    | { readonly kind: 'root-span-export-failed'; readonly message: string };
}
