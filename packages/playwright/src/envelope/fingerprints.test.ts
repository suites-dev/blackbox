import { describe, expect, it } from 'vitest';

import { digestBytes } from './canonical.js';
import { envelopeFixture, configurationFixture } from './envelope.fixture.js';
import { catalogConfiguration, environmentConfiguration } from './fingerprints.js';

describe('configuration fingerprints', () => {
  it('is stable for equal inputs and changes exactly the digest that covers a changed input', () => {
    const base = configurationFixture();
    expect(configurationFixture().fingerprint).toBe(base.fingerprint);
    const compose = configurationFixture({ compose: 'compose-v2' });
    expect(compose.catalog.digest).not.toBe(base.catalog.digest);
    expect(compose.instrumentation.digest).toBe(base.instrumentation.digest);
    expect(compose.fingerprint).not.toBe(base.fingerprint);
    const activation = configurationFixture({ activation: 'activation-v2' });
    expect(activation.instrumentation.digest).not.toBe(base.instrumentation.digest);
    expect(activation.catalog.digest).toBe(base.catalog.digest);
    expect(activation.fingerprint).not.toBe(base.fingerprint);
    expect(configurationFixture({ node: 'v22.1.0' }).fingerprint).not.toBe(base.fingerprint);
  });

  it('keeps credential values out of the fingerprint and out of the document', () => {
    const input = {
      platform: 'linux',
      arch: 'x64',
      node: 'v22',
      docker: '28',
      playwright: '1',
      workers: 1,
      project: 'p',
    };
    const one = environmentConfiguration({
      ...input,
      variables: { API_TOKEN: 'alpha', FLAG: 'on' },
    });
    const two = environmentConfiguration({
      ...input,
      variables: { API_TOKEN: 'beta', FLAG: 'on' },
    });
    expect(one.digest).toBe(two.digest);
    expect(one.secretVariableNames).toEqual(['API_TOKEN']);
    expect(JSON.stringify(one)).not.toContain('alpha');
    expect(JSON.stringify(one)).not.toContain('"on"');
    const flipped = environmentConfiguration({
      ...input,
      variables: { API_TOKEN: 'alpha', FLAG: 'off' },
    });
    expect(flipped.digest).not.toBe(one.digest);
  });
});

describe('environment secrets', () => {
  it('treats a URL carrying credentials as secret even when the variable name does not say so', () => {
    const input = {
      platform: 'p',
      arch: 'a',
      node: 'n',
      docker: 'd',
      playwright: 'p',
      workers: 1,
      project: 'p',
    };
    const one = environmentConfiguration({
      ...input,
      variables: {
        DATABASE_URL: 'postgres://app:hunter2@db:5432/app',
        PUBLIC_URL: 'https://example.test/path',
      },
    });
    expect(one.secretVariableNames).toEqual(['DATABASE_URL']);
    expect(Object.keys(one.variables)).toEqual(['PUBLIC_URL']);
    const other = environmentConfiguration({
      ...input,
      variables: {
        DATABASE_URL: 'postgres://app:different@db:5432/app',
        PUBLIC_URL: 'https://example.test/path',
      },
    });
    expect(other.digest).toBe(one.digest);
    expect(JSON.stringify(one)).not.toContain('hunter2');
  });

  it('orders inputs deterministically and tells a missing file from an empty one', () => {
    const a = {
      role: 'compose' as const,
      path: 'a.yml',
      state: 'present' as const,
      digest: digestBytes('a'),
    };
    const b = {
      role: 'compose' as const,
      path: 'b.yml',
      state: 'present' as const,
      digest: digestBytes('b'),
    };
    const forward = catalogConfiguration({ entryId: 'e', resolved: {}, inputs: [a, b] });
    expect(catalogConfiguration({ entryId: 'e', resolved: {}, inputs: [b, a] }).digest).toBe(
      forward.digest,
    );
    const missing = catalogConfiguration({
      entryId: 'e',
      resolved: {},
      inputs: [a, { ...b, state: 'missing', digest: null }],
    });
    expect(missing.digest).not.toBe(forward.digest);
  });

  it('is a function of the configuration, not of the attempt', () => {
    expect(envelopeFixture().configuration.fingerprint).toBe(configurationFixture().fingerprint);
  });
});
