/**
 * Suggested next commands. Every suggestion that targets a capsule, activity
 * or trace names its capsule explicitly (positional or --capsule), so none of
 * them depends on the current-capsule file or BLACKBOX_CAPSULE.
 */
export const nextSteps = {
  showActivity: (activity: string, capsule: string) =>
    `blackbox show ${activity} --capsule ${capsule}`,
  showTrace: (trace: string, capsule: string) => `blackbox show ${trace} --capsule ${capsule}`,
  report: (capsule: string) => `blackbox report ${capsule}`,
  down: (capsule: string) => `blackbox down ${capsule}`,
  run: (input: {
    readonly capsule: string;
    readonly driver: string | null;
    readonly entrypointUrl: string;
    readonly readinessPath: string;
  }) =>
    input.driver === null
      ? `blackbox run --capsule ${input.capsule} -- curl ${input.entrypointUrl}${input.readinessPath}`
      : `blackbox run --capsule ${input.capsule} --via ${input.driver} -- curl ${input.readinessPath}`,
} as const;

export function arrowLines(next: readonly string[]): readonly string[] {
  return next.map((command) => `→ ${command}`);
}
