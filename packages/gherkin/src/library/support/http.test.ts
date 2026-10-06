import { describe, expect, it } from 'vitest';

import { sandboxAt } from '../testing/step-harness.js';
import { entrypointUrl } from './http.js';

// Requirement (task 2.3, SECURITY.md): feature text can only address the
// Sandbox entrypoint, so a request, and the credential it may carry, never
// reaches another origin, including through URL parser normalisation.

describe('entrypointUrl', () => {
  const sandbox = sandboxAt('http://127.0.0.1:43210');

  it('resolves absolute paths on the entrypoint', () => {
    expect(entrypointUrl(sandbox, '/fixture/state')).toBe('http://127.0.0.1:43210/fixture/state');
    expect(entrypointUrl(sandbox, '/subscriptions?user=a%2Fb')).toBe('http://127.0.0.1:43210/subscriptions?user=a%2Fb');
  });

  it('refuses anything that would leave the entrypoint origin', () => {
    for (const path of [
      '//evil.example/x',
      '/\\evil.example/x',
      '/\\/evil.example/x',
      'http://evil.example/x',
      'https://127.0.0.1:43210/x',
      'relative/path',
      '',
    ]) {
      expect(() => entrypointUrl(sandbox, path), path).toThrow(/request path|origin of/u);
    }
  });
});
