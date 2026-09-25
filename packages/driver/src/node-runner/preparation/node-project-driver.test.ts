import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, it } from 'vitest';

import { driverPrepareRequest } from '../../testing/request.fixture.js';
import { prepareNodeProjectDriver } from './node-project-driver.js';

const driverSource = `export default {
  kind: 'project-driver',
  name: 'http-driver',
  prepare(request) {
    return {
      kind: 'prepared-command',
      argv: [...request.command.argv, '--header', 'traceparent: ' + request.telemetry.traceparent],
      environment: {},
      propagation: {
        kind: 'context-injected',
        format: 'w3c-trace-context',
        carrier: 'http-headers'
      },
      redaction: {
        kind: 'driver-redaction',
        requestArgv: { kind: 'none' },
        preparedArgv: { kind: 'positions', positions: [4] },
        environment: { kind: 'none' }
      }
    };
  }
};
`;

it('prepares a project driver without executing the prepared command', async () => {
  const projectDirectory = await mkdtemp(join(tmpdir(), 'blackbox-driver-runtime-'));
  const driverModulePath = join(projectDirectory, 'http-driver.mjs');
  await writeFile(driverModulePath, driverSource, 'utf8');
  await expect(
    prepareNodeProjectDriver({
      driverModulePath,
      projectDirectory,
      request: driverPrepareRequest(),
    }),
  ).resolves.toMatchObject({
    kind: 'driver-prepare-succeeded',
    preparation: {
      argv: ['curl', '--fail', '/orders', '--header', expect.stringContaining('traceparent:')],
    },
  });
});

it('rejects relative runtime paths before starting a project driver', async () => {
  await expect(
    prepareNodeProjectDriver({
      driverModulePath: 'driver.mjs',
      projectDirectory: '/project',
      request: driverPrepareRequest(),
    }),
  ).rejects.toThrow('absolute path');
});
