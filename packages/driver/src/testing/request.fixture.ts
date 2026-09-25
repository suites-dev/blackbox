import type { DriverPrepareRequest } from '../model/driver-context.js';

export function driverPrepareRequest(): DriverPrepareRequest {
  return {
    kind: 'driver-prepare-request',
    protocolVersion: 1,
    driverId: 'http-driver',
    command: { kind: 'command', argv: ['curl', '--fail', '/orders'] },
    target: {
      kind: 'participant',
      participantId: 'api',
      service: 'public-api',
      protocol: 'http',
      containerPort: 3000,
      environment: { API_TOKEN: 'secret' },
      endpoint: {
        kind: 'host',
        host: '127.0.0.1',
        port: 43123,
        url: 'http://127.0.0.1:43123',
      },
    },
    execution: { kind: 'host' },
    propagation: {
      kind: 'w3c-trace-context-propagation',
      carrier: 'http-headers',
    },
    telemetry: {
      kind: 'w3c-trace-context',
      sessionId: 'steady-harbor-alex',
      activityId: 'activity-1',
      traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
      tracestate: { kind: 'absent' },
    },
  };
}
