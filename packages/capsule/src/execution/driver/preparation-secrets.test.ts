import { afterEach, expect, it } from 'vitest';

import { runCapsuleDriver } from '../driver-execution.js';
import { cleanDriverProjects, driverInput, driverProject, driverSandbox } from './testing/execution.fixture.js';

afterEach(cleanDriverProjects);

it.each([
  { name: 'runner exit', operation: 'process.exit(23)', error: 'Driver runner exited with code 23' },
  { name: 'hard preparation timeout', operation: 'while (true) {}', error: 'Driver preparation exceeded 5000ms' },
])('keeps target secrets out of $name failures from real subprocesses', async ({ operation, error }) => {
  const secret = 'target-stderr-private';
  const directory = await driverProject(`export default {
    kind: 'project-driver', name: 'http', prepare(request) {
      process.stderr.write(request.target.environment.API_TOKEN);
      ${operation};
    }
  };`);
  const result = await runCapsuleDriver({ ...driverInput(directory),
    sandbox: driverSandbox({ API_TOKEN: secret }), untraced: { kind: 'allow' } });
  expect(result).toMatchObject({ kind: 'driver-prepare-failed',
    error: { message: expect.stringContaining(error) } });
  expect(JSON.stringify(result)).not.toContain(secret);
});

it('does not leak secret fragments from invalid driver protocol output', async () => {
  const secret = 'private-target-value-1234567890-abcdefghijklmnopqrstuvwxyz';
  const directory = await driverProject(`export default {
    kind: 'project-driver', name: 'http', prepare(request) {
      console.log(request.target.environment.API_TOKEN);
      throw new Error('preparation failed');
    }
  };`);
  const result = await runCapsuleDriver({
    ...driverInput(directory), sandbox: driverSandbox({ API_TOKEN: secret }),
  });
  expect(result).toMatchObject({ kind: 'driver-prepare-failed',
    error: { message: expect.stringContaining('Invalid JSON') } });
  expect(JSON.stringify(result)).not.toContain(secret.slice(0, 10));
});

it('masks a driver failure name as well as its message through a real subprocess', async () => {
  const secret = 'target-secret';
  const directory = await driverProject(`export default {
    kind: 'project-driver', name: 'http', prepare(request) {
      const secret = request.target.environment.API_TOKEN;
      throw Object.assign(new Error('failed ' + secret), { name: secret + 'Failure' });
    }
  };`);
  const result = await runCapsuleDriver({
    ...driverInput(directory), sandbox: driverSandbox({ API_TOKEN: secret }),
  });
  expect(result).toMatchObject({ kind: 'driver-prepare-failed',
    error: { name: '[REDACTED]Failure', message: 'failed [REDACTED]' } });
  expect(JSON.stringify(result)).not.toContain(secret);
});

it.each(['refuse', 'allow'] as const)('masks secrets in an injection failure with untraced=%s', async (kind) => {
  const secret = 'target-secret';
  const directory = await driverProject(`export default {
    kind: 'project-driver', name: 'http', prepare(request) {
      return { kind: 'prepared-command', argv: request.command.argv,
        environment: { API_TOKEN: 'prepared-secret' },
        propagation: { kind: 'context-injection-failed', format: 'w3c-trace-context',
          carrier: 'http-headers',
          message: request.target.environment.API_TOKEN + ' / prepared-secret' },
        redaction: { kind: 'driver-redaction', requestArgv: { kind: 'none' },
          preparedArgv: { kind: 'none' },
          environment: { kind: 'keys', keys: ['API_TOKEN'] } } };
    }
  };`);
  const result = await runCapsuleDriver({
    ...driverInput(directory), argv: [process.execPath, '-e', 'process.exit(0)'],
    sandbox: driverSandbox({ API_TOKEN: secret }), untraced: { kind },
  });
  expect(result).toMatchObject({
    kind: kind === 'allow' ? 'driver-completed' : 'driver-propagation-refused',
    propagation: { outcome: { message: '[REDACTED] / [REDACTED]' } },
  });
  expect(JSON.stringify(result)).not.toContain(secret);
  expect(JSON.stringify(result)).not.toContain('prepared-secret');
});
