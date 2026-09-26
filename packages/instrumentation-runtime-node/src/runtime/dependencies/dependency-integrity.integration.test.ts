import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { installInstrumentation } from '@suites/blackbox-instrumentation-internal';

import { nodeRuntimeProvider } from '../bootstrap/provider.js';

it('never reports success for an installed dependency whose executable module disappeared', async () => {
  const projectDirectory = await mkdtemp(join(tmpdir(), 'blackbox-instrumentation-corrupt-'));
  try {
    const initial = await installInstrumentation({
      projectDirectory,
      runtime: 'node',
      providers: [nodeRuntimeProvider],
    });
    if (!initial.ok) {
      throw new Error(initial.message);
    }
    const resolve = createRequire(join(initial.directory, 'package.json'));
    const sdkEntry = resolve.resolve('@opentelemetry/sdk-node');
    await rm(sdkEntry);
    const repeated = await installInstrumentation({
      projectDirectory,
      runtime: 'node',
      providers: [nodeRuntimeProvider],
    });
    if (!repeated.ok) {
      expect(repeated.kind).toBe('instrumentation-install-operational-error');
      return;
    }
    // A successful repeat must actually have repaired the tree; manifest versions are insufficient.
    const bootstrap = join(repeated.directory, 'instrumentation.js');
    const process = spawnSync(
      globalThis.process.execPath,
      ['--require', bootstrap, '--eval', 'void 0'],
      {
        cwd: projectDirectory,
        encoding: 'utf8',
        timeout: 5000,
        env: {
          ...globalThis.process.env,
          OTEL_TRACES_EXPORTER: 'none',
          OTEL_METRICS_EXPORTER: 'none',
          OTEL_LOGS_EXPORTER: 'none',
        },
      },
    );
    expect(process.status, process.stderr).toBe(0);
  } finally {
    await rm(projectDirectory, { recursive: true, force: true });
  }
}, 120_000);
