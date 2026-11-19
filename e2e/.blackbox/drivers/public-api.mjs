import { defineDriver } from '@suites/blackbox-driver';

function absoluteUrl(value, baseUrl) {
  return value.startsWith('/') ? new URL(value, `${baseUrl}/`).href : value;
}

function headerRedaction(argv) {
  const credential =
    /^(?:-H|--header=)?(?:authorization|proxy-authorization|cookie|set-cookie|x-api-key|api-key)[\t ]*:/iu;
  const positions = argv.flatMap((value, index) =>
    index > 0 && credential.test(value) ? [index] : [],
  );
  return positions.length ? { kind: 'positions', positions } : { kind: 'none' };
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
    const preparedArgv = [argv[0], ...traceArguments, ...argv.slice(1)];
    return {
      kind: 'prepared-command',
      argv: preparedArgv,
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
          : { kind: 'context-not-injected', reason: 'driver-declared-none' },
      redaction: {
        kind: 'driver-redaction',
        requestArgv: headerRedaction(request.command.argv),
        preparedArgv: headerRedaction(preparedArgv),
        environment: { kind: 'none' },
      },
    };
  },
});
