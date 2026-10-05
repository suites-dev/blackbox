/** A Sandbox environment variable whose value is read from the runner's environment. */
export interface EnvironmentSource {
  readonly fromEnv: string;
}

export type SandboxEnvironmentSpec = Readonly<Record<string, EnvironmentSource>>;

/**
 * Resolves a Sandbox profile's environment when the generated file is
 * loaded. Generated code names environment variables only, never values, so a
 * secret never lands in a generated file; a missing variable fails the load.
 */
export function sandboxEnvironment(
  spec: SandboxEnvironmentSpec,
  environment: NodeJS.ProcessEnv = process.env,
): Readonly<Record<string, string>> {
  const resolved: Record<string, string> = {};
  for (const [name, source] of Object.entries(spec)) {
    const value = environment[source.fromEnv];
    if (value === undefined) {
      throw new Error(
        `Sandbox environment ${name} reads ${source.fromEnv}, which is not set in the runner environment`,
      );
    }
    resolved[name] = value;
  }
  return Object.freeze(resolved);
}
