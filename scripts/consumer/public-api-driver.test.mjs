import assert from 'node:assert/strict';
import test from 'node:test';

import {
  decodeDriverPrepareRequest,
  decodeDriverPrepareResponse,
  validateDriverPreparation,
} from '@suites/blackbox-driver';
import driver from '../../e2e/.blackbox/drivers/public-api.mjs';

const traceparent = '00-11111111111111111111111111111111-2222222222222222-01';
const argv = [
  'curl',
  '-H',
  'Cookie: id=fixture',
  '--header=AUTHORIZATION: Basic fixture',
  '-HX-Api-Key: fixture',
  '-H',
  'Accept: application/json',
  '/orders',
];

for (const traced of [true, false]) {
  test(`reference HTTP driver declares exact credential positions with tracing ${traced ? 'enabled' : 'disabled'}`, async () => {
    const endpoint = { kind: 'host', url: 'http://127.0.0.1:4321', host: '127.0.0.1', port: 4321 };
    const request = decodeDriverPrepareRequest(
      JSON.stringify({
        kind: 'driver-prepare-request',
        protocolVersion: 1,
        driverId: 'public-api',
        command: { kind: 'command', argv },
        execution: { kind: 'host' },
        target: {
          kind: 'participant',
          participantId: 'api',
          service: 'api',
          protocol: 'http',
          containerPort: 3000,
          environment: {},
          endpoint,
        },
        telemetry: traced
          ? {
              kind: 'w3c-trace-context',
              traceparent,
              sessionId: 'quiet-river-ada',
              activityId: 'activity-1',
              tracestate: { kind: 'absent' },
            }
          : { kind: 'disabled' },
        propagation: traced
          ? { kind: 'w3c-trace-context-propagation', carrier: 'http-headers' }
          : { kind: 'propagation-not-requested' },
      }),
    );
    const preparation = await driver.prepare(request);
    decodeDriverPrepareResponse(
      JSON.stringify({
        kind: 'driver-prepare-succeeded',
        protocolVersion: 1,
        driver: { kind: 'available', name: driver.name },
        preparation,
      }),
    );
    validateDriverPreparation({ request, preparation });
    assert.deepEqual(preparation.argv, [
      'curl',
      ...(traced ? ['--header', `traceparent: ${traceparent}`] : []),
      ...argv.slice(1, -1),
      'http://127.0.0.1:4321/orders',
    ]);
    assert.deepEqual(preparation.redaction.requestArgv, {
      kind: 'positions',
      positions: [2, 3, 4],
    });
    assert.deepEqual(preparation.redaction.preparedArgv, {
      kind: 'positions',
      positions: traced ? [4, 5, 6] : [2, 3, 4],
    });
  });
}
