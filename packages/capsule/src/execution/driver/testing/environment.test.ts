import { afterEach, expect, it } from 'vitest';

import { runCapsuleDriver } from '../../driver-execution.js';
import {
  cleanDriverProjects,
  driverInput,
  driverProject,
  driverSandbox,
} from './execution.fixture.js';

afterEach(cleanDriverProjects);

it('lets a driver map a target secret while retaining only its declared mask', async () => {
  const secret = 'fixture-postgres-secret';
  const directory = await driverProject(`export default {
    kind: 'project-driver', name: 'http', prepare(request) {
      const password = request.target.environment.POSTGRES_PASSWORD;
      return { kind: 'prepared-command', argv: request.command.argv,
        environment: { PGPASSWORD: password },
        propagation: { kind: 'context-injected', format: 'w3c-trace-context',
          carrier: 'http-headers' },
        redaction: { kind: 'driver-redaction', requestArgv: { kind: 'none' },
          preparedArgv: { kind: 'none' },
          environment: { kind: 'keys', keys: ['PGPASSWORD'] } } };
    }
  };`);
  const selectedInput = driverInput(directory);
  const result = await runCapsuleDriver({
    ...selectedInput,
    argv: [process.execPath, '-e',
      `process.stdout.write(process.env.PGPASSWORD.length === ${secret.length} ? process.env.PGPASSWORD : 'missing')`],
    sandbox: driverSandbox({ POSTGRES_PASSWORD: secret }),
  });
  expect(result).toMatchObject({
    kind: 'driver-completed',
    redaction: { environment: { kind: 'keys', keys: ['PGPASSWORD'] } },
    process: { kind: 'exited', exitCode: 0, stdout: '[REDACTED]' },
  });
  expect(JSON.stringify(result)).not.toContain(secret);
});

it('does not retain a target environment value leaked by a failed driver', async () => {
  const secret = 'fixture-driver-failure-secret';
  const directory = await driverProject(`export default {
    kind: 'project-driver', name: 'http', prepare(request) {
      throw new Error('failed with ' + request.target.environment.API_TOKEN);
    }
  };`);
  const selectedInput = driverInput(directory);
  const result = await runCapsuleDriver({
    ...selectedInput,
    sandbox: driverSandbox({ API_TOKEN: secret }),
  });
  expect(result).toMatchObject({
    kind: 'driver-prepare-failed',
    error: { message: 'failed with [REDACTED]' },
  });
  expect(JSON.stringify(result)).not.toContain(secret);
});

it('replaces colliding Blackbox coordinates with the canonical resolved endpoint', async () => {
  const directory = await driverProject(`export default {
    kind: 'project-driver', name: 'http', prepare(request) {
      return { kind: 'prepared-command', argv: request.command.argv,
        environment: { DRIVER_VALUE: request.target.environment.BLACKBOX_DRIVER_HOST },
        propagation: { kind: 'context-injected', format: 'w3c-trace-context',
          carrier: 'http-headers' },
        redaction: { kind: 'driver-redaction', requestArgv: { kind: 'none' },
          preparedArgv: { kind: 'none' }, environment: { kind: 'none' } } };
    }
  };`);
  const selectedInput = driverInput(directory);
  await expect(runCapsuleDriver({
    ...selectedInput,
    sandbox: driverSandbox({ BLACKBOX_DRIVER_HOST: 'spoofed-host' }),
  })).resolves.toMatchObject({
    kind: 'driver-completed',
    process: { kind: 'exited', stdout: '127.0.0.1' },
  });
});
