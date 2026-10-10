// Name segments that mark an environment entry as a credential. Matching whole
// segments keeps names such as PASSENGER_COUNT or KEYBOARD_LAYOUT out.
const secretSegments = new Set([
  'auth',
  'authorization',
  'cookie',
  'credential',
  'credentials',
  'key',
  'pass',
  'passphrase',
  'passwd',
  'password',
  'pwd',
  'secret',
  'secrets',
  'token',
  'tokens',
]);

// Compound spellings without separators, such as DBPASSWORD or apiKey.
const secretFragment = /(?:password|passwd|passphrase|secret|token|credential|apikey|privatekey)/u;

/** Whether an environment entry's name marks its value as a secret. */
export function isSecretEnvironmentName(name: string): boolean {
  const segments = name
    .replace(/([a-z0-9])([A-Z])/gu, '$1_$2')
    .toLowerCase()
    .split(/[^a-z0-9]+/u)
    .filter((segment) => segment.length > 0);
  return (
    segments.some((segment) => secretSegments.has(segment)) ||
    secretFragment.test(name.toLowerCase())
  );
}

/** The secret environment values an attempt has seen, redacted from its progress. */
export class SecretValues {
  private readonly values = new Set<string>();

  /** Records the values of credential-named entries; other entries stay readable. */
  protect(environment: Readonly<Record<string, string>>): void {
    // Redacting every value garbles IDs and paths whenever a profile sets a
    // short flag such as `1`.
    for (const [name, value] of Object.entries(environment)) {
      if (value.length > 0 && isSecretEnvironmentName(name)) {
        this.values.add(value);
      }
    }
  }

  redact(text: string): string {
    let redacted = text;
    for (const value of [...this.values].sort((a, b) => b.length - a.length)) {
      redacted = redacted.replaceAll(value, '[REDACTED]');
    }
    return redacted;
  }
}
