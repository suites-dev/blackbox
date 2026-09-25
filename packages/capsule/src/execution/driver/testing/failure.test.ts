import { afterEach, expect, it } from 'vitest';

import { runCapsuleDriver } from '../../driver-execution.js';
import { cleanDriverProjects, driverInput, driverProject, driverSandbox } from './execution.fixture.js';

afterEach(cleanDriverProjects);

async function project(environment: string): Promise<string> {
  return driverProject(`export default {
    kind: 'project-driver', name: 'http', prepare(request) {
      return { kind: 'prepared-command', argv: request.command.argv,
        environment: ${environment},
        propagation: { kind: 'context-injected', format: 'w3c-trace-context', carrier: 'http-headers' },
        redaction: { kind: 'driver-redaction', requestArgv: { kind: 'none' },
          preparedArgv: { kind: 'none' }, environment: { kind: 'none' } } };
    }
  };`);
}

it('redacts target values from reserved-environment failure diagnostics', async () => {
  const secret = 'target-private';
  const directory = await project('{ ["BLACKBOX_OTEL_" + request.target.environment.API_TOKEN]: "value" }');
  const result = await runCapsuleDriver({
    ...driverInput(directory), sandbox: driverSandbox({ API_TOKEN: secret }),
    untraced: { kind: 'allow' },
  });
  expect(result).toMatchObject({ kind: 'driver-propagation-refused', propagation: {
    outcome: { message: 'Driver may not override reserved environment key BLACKBOX_OTEL_[REDACTED]' },
  } });
  expect(JSON.stringify(result)).not.toContain(secret);
});

it('redacts both target and prepared secrets from participant process errors', async () => {
  const directory = await project('{ API_TOKEN: "prepared-private" }');
  const base = driverInput(directory);
  const target = 'target-private';
  await expect(runCapsuleDriver({ ...base,
    driver: { ...base.driver, execution: { kind: 'participant', participantId: 'api', service: 'api' } },
    sandbox: { ...driverSandbox({ API_TOKEN: target }), startContainerExecution: () => Promise.reject(
      Object.assign(new Error(`${target} / prepared-private`), { name: `${target}Error` }),
    ) },
  })).rejects.toMatchObject({ name: '[REDACTED]Error', message: '[REDACTED] / [REDACTED]' });
});
