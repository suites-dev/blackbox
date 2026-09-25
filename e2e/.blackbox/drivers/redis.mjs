import { defineDriver } from '@suites/blackbox-driver';

export default defineDriver({
  kind: 'project-driver',
  name: 'redis',
  prepare(request) {
    return {
      kind: 'prepared-command',
      argv: request.command.argv,
      environment: {
        BLACKBOX_REDIS_HOST: request.target.endpoint.host,
        BLACKBOX_REDIS_PORT: String(request.target.endpoint.port),
      },
      propagation: {
        kind: 'context-not-supported',
        boundary: 'shared-state',
        resource: 'redis',
      },
      redaction: {
        kind: 'driver-redaction',
        requestArgv: { kind: 'none' },
        preparedArgv: { kind: 'none' },
        environment: { kind: 'none' },
      },
    };
  },
});
