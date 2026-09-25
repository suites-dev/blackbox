import { afterEach, expect, it } from 'vitest';

import { runCapsuleDriver } from '../../driver-execution.js';
import { cleanDriverProjects, driverInput, driverProject, driverSandbox } from './execution.fixture.js';

afterEach(cleanDriverProjects);

it.each([
  { edge: 'head', secret: 'private-head-private-tail', bytes: 12 },
  { edge: 'tail', secret: 'private-head-private-tail', bytes: 12 },
  { edge: 'head', secret: 'private-head🔑private-tail', bytes: 13 },
  { edge: 'tail', secret: 'private-head🔑private-tail', bytes: 13 },
])('does not retain secret fragments at the $edge boundary ($bytes bytes)', async ({ edge, secret, bytes }) => {
  const directory = await driverProject(`export default {
    kind: 'project-driver', name: 'http', prepare(request) {
      return { kind: 'prepared-command', argv: request.command.argv,
        environment: { PRIVATE: request.target.environment.API_TOKEN },
        propagation: { kind: 'context-injected', format: 'w3c-trace-context', carrier: 'http-headers' },
        redaction: { kind: 'driver-redaction', requestArgv: { kind: 'none' },
          preparedArgv: { kind: 'none' }, environment: { kind: 'keys', keys: ['PRIVATE'] } } };
    }
  };`);
  const result = await runCapsuleDriver({
    ...driverInput(directory), sandbox: driverSandbox({ API_TOKEN: secret }),
    argv: [process.execPath, '-e', `
      process.stdout.write('x'.repeat(${edge === 'head' ? 524288 - bytes : 1048576}));
      process.stdout.write(process.env.PRIVATE);
      process.stdout.write('y'.repeat(${edge === 'tail' ? 524288 - bytes : 1048576}));
    `],
  });
  expect(result).toMatchObject({ kind: 'driver-completed',
    process: { exitCode: 0, retention: { stdout: { kind: 'truncated' } } } });
  expect(JSON.stringify(result).includes('private-head')).toBe(false);
  expect(JSON.stringify(result).includes('private-tail')).toBe(false);
});
