import { expect } from '@suites/blackbox-playwright';

// Named credentials. A feature names a credential ("fixture-control"), never
// its value. In v1 every credential is a bearer token read from the runner
// environment variable BLACKBOX_CREDENTIAL_<NAME>, with the name upper-cased
// and dashes turned into underscores. The Sandbox profile maps the same
// variable into the system under test, so both sides share one secret.

const CREDENTIAL_NAME = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;

export function credentialVariable(name: string): string {
  expect(name, 'credential name (lower-case words joined by dashes)').toMatch(CREDENTIAL_NAME);
  return `BLACKBOX_CREDENTIAL_${name.toUpperCase().replaceAll('-', '_')}`;
}

/** The request headers that present the named credential. Messages name the variable, never its value. */
export function credentialHeaders(
  name: string,
  environment: NodeJS.ProcessEnv = process.env,
): Readonly<Record<string, string>> {
  const variable = credentialVariable(name);
  const value = environment[variable];
  if (value === undefined || value === '') {
    throw new Error(`Credential "${name}" reads ${variable}, which is not set in the runner environment`);
  }
  return { authorization: `Bearer ${value}` };
}
