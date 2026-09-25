import { writeFile } from 'node:fs/promises';

import { expect, it } from 'vitest';

import { managerRequest } from '../../ipc/client.js';
import { readCapsuleActivities } from '../../records.js';
import { requestFixture } from './request.fixture.js';
import { reportCapsule } from '../../session/operations.js';
import { renderCapsuleHtml } from '../../reporting/html.js';
import { serializeCapsuleReportDocument } from '../../reporting/serialization.js';

const secret = 'private-driver-secret';
const source = 'setTimeout(() => process.stdout.write("complete"), 50)';
const driverSource = `export default {
  kind: 'project-driver',
  name: 'shifted-secret',
  prepare(request) {
    return {
      kind: 'prepared-command',
      argv: [request.command.argv[0], '--no-warnings', ...request.command.argv.slice(1)],
      environment: {},
      propagation: {
        kind: 'context-not-supported', boundary: 'shared-state', resource: 'test'
      },
      redaction: {
        kind: 'driver-redaction',
        requestArgv: { kind: 'positions', positions: [3] },
        preparedArgv: { kind: 'positions', positions: [4] },
        environment: { kind: 'none' }
      }
    };
  }
};`;

type Fixture = Awaited<ReturnType<typeof requestFixture>>;

async function installShiftedDriver(fixture: Fixture): Promise<void> {
  await writeFile(`${fixture.projectDirectory}/shifted-secret.mjs`, driverSource);
  Object.assign(fixture.manager.drivers, {
    'shifted-secret': {
      id: 'shifted-secret',
      kind: 'project-driver',
      runtime: 'node',
      ref: 'shifted-secret.mjs',
      target: {
        kind: 'participant',
        participantId: 'api',
        service: 'api',
        protocol: 'http',
        containerPort: 3000,
      },
      execution: { kind: 'host' },
      propagation: {
        kind: 'shared-state-propagation-unsupported',
        resource: 'test',
      },
    },
  });
  fixture.endpoints.set('driver-shifted-secret', {
    name: 'driver-shifted-secret',
    service: 'api',
    containerPort: 3000,
    host: '127.0.0.1',
    port: 4567,
  });
}

async function waitForRunning(fixture: Fixture): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    const activities = await readCapsuleActivities(fixture);
    if (activities.length === 1 && activities[0].kind === 'running') {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('Timed out waiting for running driver activity');
}

function execute(fixture: Fixture) {
  return managerRequest({
    socketPath: fixture.socketPath,
    request: {
      kind: 'exec-request',
      requestId: 'redaction-1',
      name: { kind: 'omitted' },
      purpose: 'stimulus',
      target: {
        kind: 'driver',
        driverId: 'shifted-secret',
        argv: [process.execPath, '-e', source, secret],
        untraced: { kind: 'refuse' },
      },
    },
  });
}

it('keeps request and prepared redaction positions in separate coordinate spaces', async () => {
  const fixture = await requestFixture(() => Promise.resolve());
  await installShiftedDriver(fixture);
  try {
    const response = execute(fixture);
    await waitForRunning(fixture);
    const running = await readCapsuleActivities(fixture);
    const [activity] = running;
    expect(activity.argv).toEqual([
      process.execPath,
      '[REDACTED]',
      '[REDACTED]',
      '[REDACTED]',
    ]);
    expect(JSON.stringify(running)).not.toContain(secret);
    await expect(response).resolves.toMatchObject({
      kind: 'exec-response',
      outcome: {
        kind: 'driver-completed',
        process: {
          argv: [process.execPath, '--no-warnings', '-e', source, '[REDACTED]'],
          stdout: 'complete',
        },
      },
    });
    const completed = await readCapsuleActivities(fixture);
    expect(completed[0]).toMatchObject({
      kind: 'completed',
      argv: [process.execPath, '-e', source, '[REDACTED]'],
      outcome: {
        process: { argv: [process.execPath, '--no-warnings', '-e', source, '[REDACTED]'] },
      },
    });
    expect(JSON.stringify(completed)).not.toContain(secret);
  } finally {
    await fixture.close();
  }
});

it('never retains a driver-mapped container secret in response or activity artifacts', async () => {
  const environmentSecret = 'container-environment-secret';
  const fixture = await requestFixture(
    () => Promise.resolve(),
    { API_TOKEN: environmentSecret },
  );
  const environmentDriver = `export default {
    kind: 'project-driver', name: 'environment-secret', prepare(request) {
      return {
        kind: 'prepared-command', argv: request.command.argv,
        environment: { EXECUTION_SECRET: request.target.environment.API_TOKEN },
        propagation: {
          kind: 'context-not-supported', boundary: 'shared-state', resource: 'test'
        },
        redaction: {
          kind: 'driver-redaction', requestArgv: { kind: 'none' },
          preparedArgv: { kind: 'none' },
          environment: { kind: 'keys', keys: ['EXECUTION_SECRET'] }
        }
      };
    }
  };`;
  await writeFile(`${fixture.projectDirectory}/environment-secret.mjs`, environmentDriver);
  Object.assign(fixture.manager.drivers, {
    'environment-secret': {
      id: 'environment-secret', kind: 'project-driver', runtime: 'node',
      ref: 'environment-secret.mjs',
      target: { kind: 'participant', participantId: 'api', service: 'api',
        protocol: 'http', containerPort: 3000 },
      execution: { kind: 'host' },
      propagation: { kind: 'shared-state-propagation-unsupported', resource: 'test' },
    },
  });
  fixture.endpoints.set('driver-environment-secret', {
    name: 'driver-environment-secret', service: 'api', containerPort: 3000,
    host: '127.0.0.1', port: 4567,
  });
  try {
    await writeFile(`${fixture.projectDirectory}/blackbox.config.yaml`, 'schemaVersion: 1\n');
    const response = await managerRequest({
      socketPath: fixture.socketPath,
      request: {
        kind: 'exec-request', requestId: 'environment-redaction',
        name: { kind: 'omitted' }, purpose: 'stimulus',
        target: { kind: 'driver', driverId: 'environment-secret',
          argv: [process.execPath, '-e', 'process.stdout.write(process.env.EXECUTION_SECRET)'],
          untraced: { kind: 'refuse' } },
      },
    });
    const activities = await readCapsuleActivities(fixture);
    expect(response).toMatchObject({
      kind: 'exec-response',
      outcome: { kind: 'driver-completed', process: { stdout: '[REDACTED]' } },
    });
    expect(activities).toMatchObject([
      { kind: 'completed', outcome: { process: { stdout: '[REDACTED]' } } },
    ]);
    expect(JSON.stringify({ response, activities })).not.toContain(environmentSecret);
    const report = await reportCapsule(fixture);
    expect(report.kind).toBe('capsule-report');
    if (report.kind !== 'capsule-report') {
      throw new Error(`Unexpected report result: ${report.kind}`);
    }
    expect(report.document.activities).toMatchObject([
      { outcome: { process: { stdout: '[REDACTED]' } } },
    ]);
    expect(serializeCapsuleReportDocument({ document: report.document })).not.toContain(environmentSecret);
    expect(renderCapsuleHtml({ report: report.document })).not.toContain(environmentSecret);
  } finally {
    await fixture.close();
  }
});
