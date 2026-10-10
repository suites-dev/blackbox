/**
 * A named credential in a Sandbox profile. v1 credentials are bearer tokens
 * read from a runner environment variable; the profile names the variable,
 * never the value.
 */
export interface CredentialSource {
  readonly scheme: 'bearer';
  readonly fromEnv: string;
}

export type SandboxCredentialSpec = Readonly<Record<string, CredentialSource>>;

/** A named credential of the feature's Sandbox profile, resolved when the generated file loads. */
export interface ResolvedCredential {
  readonly scheme: 'bearer';
  readonly token: string;
}

/** The credentials of one Sandbox profile, by name. Features name credentials, never values. */
export type SandboxCredentials = Readonly<Record<string, ResolvedCredential>>;

/**
 * Resolves a Sandbox profile's credentials when the generated file is loaded,
 * as `sandboxEnvironment` resolves its environment. A missing or empty
 * variable fails the load; messages name the variable, never its value.
 */
export function sandboxCredentials(
  spec: SandboxCredentialSpec,
  environment: NodeJS.ProcessEnv = process.env,
): SandboxCredentials {
  const resolved = Object.entries(spec).map(([name, source]) => {
    const token = environment[source.fromEnv];
    if (token === undefined || token === '') {
      throw new Error(
        `Credential "${name}" reads ${source.fromEnv}, which is not set in the runner environment`,
      );
    }
    return [name, Object.freeze({ scheme: source.scheme, token })] as const;
  });
  // Own entries only: a credential name never becomes an assignment target.
  return Object.freeze(Object.fromEntries(resolved));
}
