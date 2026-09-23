import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { generateCapsuleIdentity } from './identity.js';
import { reserveCapsuleRecord } from './start.js';

describe('Capsule identity', () => {
  it('generates memorable selectors while retaining an internal UUID', () => {
    const identities = Array.from({ length: 32 }, () => generateCapsuleIdentity());
    for (const identity of identities) {
      expect(identity.sessionId).toMatch(/^[a-z]+-[a-z]+-[a-z]+$/u);
      expect(identity.executionId).toMatch(/^[0-9a-f-]{36}$/u);
    }
    expect(new Set(identities.map(({ executionId }) => executionId)).size).toBe(32);
  });
});

describe('Capsule identity reservation', () => {
  it('regenerates after an atomic friendly-selector collision', async () => {
    const projectDirectory = await mkdtemp(join(tmpdir(), 'capsule-identity-'));
    const identities = [
      { sessionId: 'flying-suite-jacob', executionId: '00000000-0000-4000-8000-000000000001' },
      { sessionId: 'flying-suite-jacob', executionId: '00000000-0000-4000-8000-000000000002' },
      { sessionId: 'quiet-river-ada', executionId: '00000000-0000-4000-8000-000000000003' },
    ];
    const start = {
      projectDirectory,
      systemId: 'orders',
      description: undefined,
      environment: {},
      progress: { kind: 'silent' },
    } as const;
    const nextIdentity = () => {
      const identity = identities.shift();
      if (identity === undefined) {
        throw new Error('Identity fixture exhausted');
      }
      return identity;
    };
    try {
      const first = await reserveCapsuleRecord({
        start,
        projectDirectory,
        generateIdentity: nextIdentity,
      });
      const second = await reserveCapsuleRecord({
        start,
        projectDirectory,
        generateIdentity: nextIdentity,
      });
      expect(first.sessionId).toBe('flying-suite-jacob');
      expect(first.artifactRoot).toBe(
        join(projectDirectory, '.blackbox', 'experiments', 'capsule-flying-suite-jacob'),
      );
      expect(second.sessionId).toBe('quiet-river-ada');
      expect(second.artifactRoot).toBe(
        join(projectDirectory, '.blackbox', 'experiments', 'capsule-quiet-river-ada'),
      );
      expect(second.executionId).not.toBe(first.executionId);
    } finally {
      await rm(projectDirectory, { recursive: true, force: true });
    }
  });
});
