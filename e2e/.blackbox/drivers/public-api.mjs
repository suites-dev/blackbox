import { defineDriver } from '@suites/blackbox-driver';

function absoluteUrl(value, baseUrl) {
  return value.startsWith('/') ? new URL(value, `${baseUrl}/`).href : value;
}

export default defineDriver({
  kind: 'project-driver',
  name: 'public-api',
  prepare(request) {
    const telemetry = request.telemetry;
    const traceArguments =
      telemetry.kind === 'w3c-trace-context'
        ? ['--header', `traceparent: ${telemetry.traceparent}`]
        : [];
    const argv = request.command.argv.map((value, index) =>
      index === 0 ? value : absoluteUrl(value, request.target.endpoint.url),
    );
    return {
      kind: 'prepared-command',
      argv: [argv[0], ...traceArguments, ...argv.slice(1)],
      environment: {
        BLACKBOX_DRIVER_HOST: request.target.endpoint.host,
        BLACKBOX_DRIVER_PORT: String(request.target.endpoint.port),
        BLACKBOX_DRIVER_URL: request.target.endpoint.url,
      },
      propagation:
        telemetry.kind === 'w3c-trace-context'
          ? {
              kind: 'context-injected',
              format: 'w3c-trace-context',
              carrier: 'http-headers',
            }
          : { kind: 'context-not-injected', reason: 'telemetry context is unavailable' },
      redaction: {
        kind: 'driver-redaction',
        requestArgv: { kind: 'none' },
        preparedArgv: { kind: 'none' },
        environment: { kind: 'none' },
      },
    };
  },
});
