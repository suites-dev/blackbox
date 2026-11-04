/** Set by the Blackbox reporter (or by the user) so every attempt of one Playwright invocation shares it. */
export const invocationVariable = 'BLACKBOX_INVOCATION_ID';

/**
 * The invocation an attempt belongs to, or `null` when none is known. A CI run id is used only when nothing more
 * specific was set, because one CI job can run Playwright more than once.
 */
export function invocationId(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): string | null {
  const explicit = environment[invocationVariable];
  if (explicit !== undefined && explicit !== '') {
    return `invocation:${explicit}`;
  }
  const run = environment.GITHUB_RUN_ID;
  if (environment.GITHUB_ACTIONS === 'true' && run !== undefined && run !== '') {
    return `github:${run}:${environment.GITHUB_RUN_ATTEMPT ?? '1'}`;
  }
  return null;
}
