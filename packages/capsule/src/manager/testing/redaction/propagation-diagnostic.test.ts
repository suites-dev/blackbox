import { writeFile } from 'node:fs/promises';

import { expect, it } from 'vitest';

import { managerRequest } from '../../../ipc/client.js';
import { renderCapsuleHtml } from '../../../reporting/html.js';
import { serializeCapsuleReportDocument } from '../../../reporting/serialization.js';
import { readCapsuleActivities } from '../../../records.js';
import { reportCapsule } from '../../../session/operations.js';
import { requestFixture } from '../request.fixture.js';

const requestSecret = 'request-argv-private';
const preparedSecret = 'prepared-argv-private';

const driverSource = `export default {
  kind: 'project-driver',
  name: 'failed-propagation',
  prepare(request) {
    return {
      kind: 'prepared-command',
      argv: [request.command.argv[0], '--no-warnings', ...request.command.argv.slice(1),
        '${preparedSecret}'],
      environment: {},
      propagation: {
        kind: 'context-injection-failed',
        format: 'w3c-trace-context',
        carrier: 'http-headers',
        message: request.command.argv[3] + ' / ${preparedSecret}'
      },
      redaction: {
        kind: 'driver-redaction',
        requestArgv: { kind: 'positions', positions: [3] },
        preparedArgv: { kind: 'positions', positions: [4, 5] },
        environment: { kind: 'none' }
      }
    };
  }
};`;

it.each(['allow', 'refuse'] as const)(
  'keeps request and prepared argv secrets out of retained %s propagation failures',
  async (untraced) => {
    const fixture = await requestFixture(() => Promise.resolve());
    await writeFile(`${fixture.projectDirectory}/blackbox.config.yaml`, 'schemaVersion: 1\n');
    await writeFile(`${fixture.projectDirectory}/failed-propagation.mjs`, driverSource);
    Object.assign(fixture.manager.drivers, {
      'failed-propagation': {
        id: 'failed-propagation',
        kind: 'project-driver',
        runtime: 'node',
        ref: 'failed-propagation.mjs',
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
    fixture.endpoints.set('driver-failed-propagation', {
      name: 'driver-failed-propagation',
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
          requestId: `propagation-${untraced}`,
          name: { kind: 'omitted' },
          purpose: 'stimulus',
          target: {
            kind: 'driver',
            driverId: 'failed-propagation',
            argv: [process.execPath, '-e', 'process.exit(0)', requestSecret],
            untraced: { kind: untraced },
          },
        },
      });
      const activities = await readCapsuleActivities(fixture);
      const report = await reportCapsule(fixture);
      expect(report.kind).toBe('capsule-report');
      if (report.kind !== 'capsule-report') {
        throw new Error(`Unexpected report result: ${report.kind}`);
      }
      const artifacts = JSON.stringify({ response, activities, report: report.document });
      expect(artifacts).toContain('[REDACTED] / [REDACTED]');
      expect(artifacts).not.toContain(requestSecret);
      expect(artifacts).not.toContain(preparedSecret);
      expect(serializeCapsuleReportDocument({ document: report.document }))
        .not.toContain(requestSecret);
      expect(renderCapsuleHtml({ report: report.document })).not.toContain(preparedSecret);
    } finally {
      await fixture.close();
    }
  },
);
