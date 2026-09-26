import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { startSandbox } from '../sandbox.js';
import type { SandboxHandle } from '../types.js';

const fixtureDirectory = join(dirname(fileURLToPath(import.meta.url)), '../../test-fixtures');
let active: SandboxHandle | null = null;

afterEach(async () => {
  if (active !== null) {
    await active.stop({ reason: 'completed' });
    active = null;
  }
});

describe.skipIf(process.env.BLACKBOX_SANDBOX_DOCKER_TEST !== '1')(
  'explicit endpoint exposure',
  () => {
    it('maps an unpublished Compose port to loopback and makes it reachable', async () => {
      const compose = await readFile(join(fixtureDirectory, 'concurrency.compose.yaml'), 'utf8');
      expect(compose).not.toContain('ports:');
      const sandboxId = `endpoint-${randomUUID()}`;
      active = await startSandbox({
        sandbox: {
          sandboxId,
          projectDirectory: fixtureDirectory,
          composeFiles: ['concurrency.compose.yaml'],
          recordDirectory: join(fixtureDirectory, '.records', sandboxId),
          environment: { SANDBOX_ID: sandboxId },
          serviceSelection: { kind: 'selected', services: ['echo'] },
          endpoints: [{ name: 'http', service: 'echo', containerPort: 80 }],
          startupTimeoutMs: 60_000,
          stopTimeoutMs: 20_000,
          telemetry: { kind: 'disabled' },
        },
        progress: { kind: 'silent' },
      });
      const endpoint = active.endpoints.get('http');
      expect(endpoint).toBeDefined();
      if (endpoint === undefined) {
        throw new Error('Expected mapped endpoint');
      }
      expect(endpoint.host).toBe('localhost');
      await expect(fetch(`http://${endpoint.host}:${endpoint.port}`).then((value) => value.text()))
        .resolves.toContain(sandboxId);
    }, 90_000);
  },
);
