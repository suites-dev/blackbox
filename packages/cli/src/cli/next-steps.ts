/**
 * A suggestion is meant to be pasted into a shell. Plain URLs and paths stay as
 * they are; anything else (`&`, `;`, spaces, quotes…) is single-quoted.
 */
export function shellArgument(value: string): string {
  return /^[A-Za-z0-9_./:=@%+,-]+$/u.test(value) ? value : `'${value.replaceAll("'", `'\\''`)}'`;
}

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
  /**
   * The readiness probe as a run suggestion. `readinessUrl` is the URL the
   * capsule actually probed (already resolved against the entrypoint), so a
   * catalog path such as `health` never yields `…:PORThealth`. A driver takes
   * the path; a host curl takes the whole URL.
   */
  run: (input: {
    readonly capsule: string;
    readonly driver: string | null;
    readonly readinessUrl: string;
  }) => {
    if (input.driver === null) {
      return `blackbox run --capsule ${input.capsule} -- curl ${shellArgument(input.readinessUrl)}`;
    }
    const url = new URL(input.readinessUrl);
    return `blackbox run --capsule ${input.capsule} --via ${input.driver} -- curl ${shellArgument(`${url.pathname}${url.search}`)}`;
  },
} as const;

export function arrowLines(next: readonly string[]): readonly string[] {
  return next.map((command) => `→ ${command}`);
}
