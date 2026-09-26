import assert from 'node:assert/strict';
import test from 'node:test';

import postgresDriver from '../.blackbox/drivers/postgres.mjs';

const argv = [
  'psql',
  '--username',
  'fixture',
  '--dbname',
  'subscriptions',
  '--tuples-only',
  '--no-align',
  '--command',
  "SELECT user_id || '|' || status FROM subscriptions WHERE user_id = 'alice';",
];

function request() {
  return {
    kind: 'driver-prepare-request',
    protocolVersion: 1,
    driverId: 'postgres',
    command: { kind: 'command', argv },
    target: {
      kind: 'participant',
      participantId: 'postgres',
      service: 'postgres',
      protocol: 'postgresql',
      containerPort: 5432,
      environment: {
        POSTGRES_DB: 'subscriptions',
        POSTGRES_PASSWORD: 'fixture',
        POSTGRES_USER: 'fixture',
      },
      endpoint: {
        kind: 'participant',
        host: 'postgres',
        port: 5432,
        url: 'postgresql://postgres:5432',
      },
    },
    execution: { kind: 'participant', participantId: 'postgres', service: 'postgres' },
    propagation: { kind: 'shared-state-propagation-unsupported', resource: 'postgresql' },
    telemetry: { kind: 'disabled' },
  };
}

void test('maps participant connection credentials without changing user psql argv', () => {
  const preparation = postgresDriver.prepare(request());
  assert.deepEqual(preparation.argv, argv);
  assert.deepEqual(preparation.environment, {
    PGHOST: 'postgres',
    PGPORT: '5432',
    PGPASSWORD: 'fixture',
  });
  assert.deepEqual(preparation.propagation, {
    kind: 'context-not-supported',
    boundary: 'shared-state',
    resource: 'postgresql',
  });
  assert.deepEqual(preparation.redaction.environment, {
    kind: 'keys',
    keys: ['PGPASSWORD'],
  });

  const retained = {
    kind: 'capsule-exec-completed',
    activityId: 'activity-postgres',
    outcome: {
      kind: 'driver-completed',
      driver: {
        id: 'postgres',
        target: request().target,
        execution: request().execution,
      },
      propagation: {
        schemaVersion: 1,
        kind: 'telemetry-propagation-v1',
        expectation: request().propagation,
        outcome: preparation.propagation,
      },
      redaction: preparation.redaction,
      process: {
        kind: 'exited',
        argv,
        location: request().execution,
        exitCode: 0,
        stdout: 'alice|active\n',
        stderr: '',
        retention: {
          stdout: { kind: 'complete', originalBytes: 13 },
          stderr: { kind: 'complete', originalBytes: 0 },
        },
      },
    },
  };
  assert.equal(Object.hasOwn(retained.outcome, 'environment'), false);
  assert.equal(JSON.stringify(retained).includes('"PGPASSWORD":"fixture"'), false);
  assert.deepEqual(retained.outcome.redaction.environment, {
    kind: 'keys',
    keys: ['PGPASSWORD'],
  });
});
