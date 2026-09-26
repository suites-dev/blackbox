import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, it } from 'vitest';

import { nodeInstrumentationSource } from './bundle.js';

it('fails the application start loudly when runtime dependencies are unavailable', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'blackbox-bootstrap-failure-'));
  const bootstrap = join(directory, 'instrumentation.js');
  try {
    await writeFile(bootstrap, nodeInstrumentationSource);
    const result = spawnSync(process.execPath, ['--require', bootstrap, '--eval', 'void 0'], {
      cwd: directory,
      encoding: 'utf8',
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Cannot find module '@opentelemetry/sdk-node'");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
