import { expect, it } from 'vitest';

import { driverPreparation } from '../testing/preparation.fixture.js';
import { driverPrepareRequest } from '../testing/request.fixture.js';
import { DriverProtocolError } from './protocol-error.js';
import { validateDriverPreparation } from './preparation-validation.js';

it('accepts an adapted command that preserves its executable and declared carrier', () => {
  const preparation = driverPreparation();
  expect(
    validateDriverPreparation({ request: driverPrepareRequest(), preparation }),
  ).toBe(preparation);
});

it.each([
  { ...driverPreparation(), argv: ['wget'] },
  {
    ...driverPreparation(),
    propagation: {
      kind: 'context-injected' as const,
      format: 'w3c-trace-context' as const,
      carrier: 'message-metadata' as const,
    },
  },
  {
    ...driverPreparation(),
    redaction: {
      kind: 'driver-redaction' as const,
      requestArgv: { kind: 'none' as const },
      preparedArgv: { kind: 'positions' as const, positions: [99] },
      environment: { kind: 'none' as const },
    },
  },
  {
    ...driverPreparation(),
    redaction: {
      kind: 'driver-redaction' as const,
      requestArgv: { kind: 'none' as const },
      preparedArgv: { kind: 'none' as const },
      environment: { kind: 'keys' as const, keys: ['MISSING_SECRET'] },
    },
  },
])('rejects unsafe or dishonest preparation %#', (preparation) => {
  expect(() =>
    validateDriverPreparation({ request: driverPrepareRequest(), preparation }),
  ).toThrow(DriverProtocolError);
});

it('validates request and prepared positions against their own argv coordinate spaces', () => {
  const request = driverPrepareRequest();
  const preparation = {
    ...driverPreparation(),
    argv: ['curl', '--header', 'traceparent: value', '--fail', '/orders'],
    redaction: {
      kind: 'driver-redaction' as const,
      requestArgv: { kind: 'positions' as const, positions: [2] },
      preparedArgv: { kind: 'positions' as const, positions: [4] },
      environment: { kind: 'none' as const },
    },
  };
  expect(validateDriverPreparation({ request, preparation })).toBe(preparation);
  expect(() =>
    validateDriverPreparation({
      request,
      preparation: {
        ...preparation,
        redaction: {
          ...preparation.redaction,
          requestArgv: { kind: 'positions', positions: [3] },
        },
      },
    }),
  ).toThrow('outside the request command');
});

it('accepts an explicit injection failure for a traced boundary', () => {
  const preparation = {
    ...driverPreparation(),
    propagation: {
      kind: 'context-injection-failed' as const,
      format: 'w3c-trace-context' as const,
      carrier: 'http-headers' as const,
      message: 'unsupported curl variant',
    },
  };
  expect(
    validateDriverPreparation({ request: driverPrepareRequest(), preparation }),
  ).toBe(preparation);
});

it('requires an exact shared-state limitation', () => {
  const request = {
    ...driverPrepareRequest(),
    propagation: {
      kind: 'shared-state-propagation-unsupported' as const,
      resource: 'postgresql',
    },
  };
  const preparation = {
    ...driverPreparation(),
    propagation: {
      kind: 'context-not-supported' as const,
      boundary: 'shared-state' as const,
      resource: 'postgresql',
    },
  };
  expect(validateDriverPreparation({ request, preparation })).toBe(preparation);
  expect(() =>
    validateDriverPreparation({
      request,
      preparation: { ...preparation, propagation: { ...preparation.propagation, resource: 'redis' } },
    }),
  ).toThrow('preserve its resource limitation');
});
