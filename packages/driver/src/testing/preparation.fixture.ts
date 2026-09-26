import type { DriverPreparation } from '../model/preparation.js';

export function driverPreparation(): DriverPreparation {
  return {
    kind: 'prepared-command',
    argv: ['curl', '--fail', '/orders', '--header', 'traceparent: value'],
    environment: {},
    propagation: {
      kind: 'context-injected',
      format: 'w3c-trace-context',
      carrier: 'http-headers',
    },
    redaction: {
      kind: 'driver-redaction',
      requestArgv: { kind: 'none' },
      preparedArgv: { kind: 'positions', positions: [4] },
      environment: { kind: 'none' },
    },
  };
}
