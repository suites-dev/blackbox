import { expect } from '../../effects/expect.js';

import type { SandboxCredentials } from '../../step-runtime/credentials.js';

// Named credentials. A feature names a credential ("fixture-control"), never
// its value. The feature's Sandbox profile in the protected project file
// defines each credential as a bearer token read from a runner environment
// variable; the generated file resolves them when it loads. The same profile
// can map that variable into the system under test, so both sides share one
// secret.

const CREDENTIAL_NAME = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;

/** The request headers that present the named credential. Messages name the credential, never its value. */
export function credentialHeaders(
  name: string,
  credentials: SandboxCredentials,
): Readonly<Record<string, string>> {
  expect(name, 'credential name (lower-case words joined by dashes)').toMatch(CREDENTIAL_NAME);
  if (!Object.hasOwn(credentials, name)) {
    throw new Error(`Credential "${name}" is not defined by the feature's Sandbox profile`);
  }
  const credential = credentials[name];
  return { authorization: `Bearer ${credential.token}` };
}
