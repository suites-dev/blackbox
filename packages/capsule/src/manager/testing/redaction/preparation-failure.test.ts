import { writeFile } from 'node:fs/promises';

import { expect, it } from 'vitest';

import { managerRequest } from '../../../ipc/client.js';
import { renderCapsuleHtml } from '../../../reporting/html.js';
import { serializeCapsuleReportDocument } from '../../../reporting/serialization.js';
import { readCapsuleActivities } from '../../../records.js';
import { reportCapsule } from '../../../session/operations.js';
import { requestFixture } from '../request.fixture.js';

const secret = 'request-preparation-private';
const driverSource = `export default {
  kind: 'project-driver',
  name: 'failed-preparation',
  prepare(request) {
    const secret = request.command.argv[2];
    throw Object.assign(new Error('failed ' + secret), { name: secret + 'Failure' });
  }
};`;

it('keeps request arguments out of preparation failure artifacts', async () => {
  const fixture = await requestFixture(() => Promise.resolve());
  await writeFile(`${fixture.projectDirectory}/blackbox.config.yaml`, 'schemaVersion: 1\n');
  await writeFile(`${fixture.projectDirectory}/failed-preparation.mjs`, driverSource);
  Object.assign(fixture.manager.drivers, {
    'failed-preparation': {
      id: 'failed-preparation',
      kind: 'project-driver',
      runtime: 'node',
      ref: 'failed-preparation.mjs',
      target: {
        kind: 'participant',
        participantId: 'api',
        service: 'api',
        protocol: 'http',
        containerPort: 3000,
      },
      execution: { kind: 'host' },
      propagation: {
        kind: 'w3c-trace-context-propagation',
        carrier: 'http-headers',
      },
    },
  });
  fixture.endpoints.set('driver-failed-preparation', {
    name: 'driver-failed-preparation',
    service: 'api',
    containerPort: 3000,
    host: '127.0.0.1',
    port: 4567,
  });
  try {
    const response = await managerRequest({
      socketPath: fixture.socketPath,
      request: {
        kind: 'exec-request',
        requestId: 'preparation-failure',
        name: { kind: 'omitted' },
        purpose: 'stimulus',
        target: {
          kind: 'driver',
          driverId: 'failed-preparation',
          argv: [process.execPath, '--token', secret],
          untraced: { kind: 'refuse' },
        },
      },
    });
    expect(response).toMatchObject({
      kind: 'exec-response',
      outcome: {
        kind: 'driver-prepare-failed',
        error: { name: '[REDACTED]Failure', message: 'failed [REDACTED]' },
      },
    });
    const activities = await readCapsuleActivities(fixture);
    expect(activities).toMatchObject([{
      kind: 'completed',
      argv: [process.execPath, '[REDACTED]', '[REDACTED]'],
      outcome: { error: { message: 'failed [REDACTED]' } },
    }]);
    const report = await reportCapsule(fixture);
    expect(report.kind).toBe('capsule-report');
    if (report.kind !== 'capsule-report') {
      throw new Error(`Unexpected report result: ${report.kind}`);
    }
    const artifacts = JSON.stringify({ response, activities, report: report.document });
    expect(artifacts).not.toContain(secret);
    expect(serializeCapsuleReportDocument({ document: report.document })).not.toContain(secret);
    expect(renderCapsuleHtml({ report: report.document })).not.toContain(secret);
  } finally {
    await fixture.close();
  }
});
