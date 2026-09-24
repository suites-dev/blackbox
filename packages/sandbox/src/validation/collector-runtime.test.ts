import { mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';

import { sandboxFixture } from '../lifecycle/runtime.fixture.js';
import type { SandboxInput } from '../types.js';
import { validateSandboxInput } from './input.js';

function mountedInput(input: SandboxInput, sourceDirectory: string): SandboxInput {
  return {
    ...input,
    telemetry: {
      kind: 'enabled',
      sessionId: 'session-1',
      executionId: 'execution-1',
      authorization: { kind: 'bearer-token', token: 'secret' },
      collector: {
        service: 'blackbox-collector',
        containerPort: 4318,
        runtime: {
          kind: 'mounted-node',
          image: 'node:test@sha256:runtime',
          sourceDirectory,
          targetDirectory: '/blackbox/collector',
          entrypoint: 'main.js',
          user: 'node',
        },
        environment: {},
        readiness: {
          kind: 'http',
          path: '/ready',
          intervalSeconds: 1,
          timeoutSeconds: 1,
          retries: 1,
        },
        drain: { kind: 'signal', signal: 'SIGTERM' },
      },
      participants: [{ service: 'orders', runtime: 'node', environment: {}, mounts: [] }],
    },
  };
}

it('rejects a mounted collector entrypoint symlink that escapes its runtime', async () => {
  const { input, root } = await sandboxFixture();
  const runtime = join(root, 'collector-runtime');
  const outside = await mkdtemp(join(tmpdir(), 'collector-outside-'));
  await mkdir(runtime);
  await writeFile(join(outside, 'main.js'), 'export {};\n');
  await symlink(join(outside, 'main.js'), join(runtime, 'main.js'));
  await expect(validateSandboxInput(mountedInput(input, runtime))).rejects.toThrow(
    'collector entrypoint escapes its runtime',
  );
});
