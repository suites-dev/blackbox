import { defineDriver } from '@suites/blackbox-driver';

export default defineDriver({
  kind: 'project-driver',
  name: 'postgres',
  prepare(request) {
    const password = request.target.environment.POSTGRES_PASSWORD;
    if (typeof password !== 'string' || password.length === 0) {
      throw new Error('postgres driver requires participant POSTGRES_PASSWORD');
    }
    return {
      kind: 'prepared-command',
      argv: request.command.argv,
      environment: {
        PGHOST: request.target.endpoint.host,
        PGPORT: String(request.target.endpoint.port),
        PGPASSWORD: password,
      },
      propagation: {
        kind: 'context-not-supported',
        boundary: 'shared-state',
        resource: 'postgresql',
      },
      redaction: {
        kind: 'driver-redaction',
        requestArgv: { kind: 'none' },
        preparedArgv: { kind: 'none' },
        environment: { kind: 'keys', keys: ['PGPASSWORD'] },
      },
    };
  },
});
