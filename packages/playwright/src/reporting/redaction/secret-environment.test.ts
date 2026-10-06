import { describe, expect, it } from 'vitest';

import { isSecretEnvironmentName, SecretValues } from './secret-environment.js';

// Benchmark F10: N1 ran with a `price-stopped` profile, TT_PRICE_STOPPED=1 or =stopped.
const sandboxId = 'playwright-22a185a1-0402-44f6-8811-72bc91dae398';
const artifactPath = 'features-high-speed-search-61a63-ts-price-service-is-stopped';

describe('attempt progress redaction', () => {
  it('keeps IDs and paths intact when a profile sets a short non-secret value', () => {
    for (const value of ['1', 'stopped']) {
      const secrets = new SecretValues();
      secrets.protect({ TT_PRICE_STOPPED: value });

      expect(secrets.redact(sandboxId)).toBe(sandboxId);
      expect(secrets.redact(artifactPath)).toBe(artifactPath);
    }
  });

  it('still redacts every occurrence of a credential-named value', () => {
    const secrets = new SecretValues();
    secrets.protect({
      TT_TRAVELLER_TOKEN: 'synthetic-traveller-token',
      DB_PASSWORD: 'hunter2',
      TT_PRICE_STOPPED: '1',
    });

    expect(secrets.redact('login with synthetic-traveller-token as hunter2 after 1 try')).toBe(
      'login with [REDACTED] as [REDACTED] after 1 try',
    );
  });

  it('classifies credential names by whole segment or compound spelling', () => {
    for (const name of [
      'TOKEN',
      'TT_TRAVELLER_TOKEN',
      'DB_PASSWORD',
      'PGPASSWORD',
      'POSTGRES_PASS',
      'apiKey',
      'API_KEY',
      'STRIPE_SECRET_KEY',
      'AUTH_HEADER',
      'SESSION_COOKIE',
      'clientSecret',
      'AWS_CREDENTIALS',
    ]) {
      expect(isSecretEnvironmentName(name), name).toBe(true);
    }
    for (const name of [
      'TT_PRICE_STOPPED',
      'FEATURE_MODE',
      'PASSENGER_COUNT',
      'KEYBOARD_LAYOUT',
      'AUTHOR',
      'LOG_LEVEL',
    ]) {
      expect(isSecretEnvironmentName(name), name).toBe(false);
    }
  });
});
