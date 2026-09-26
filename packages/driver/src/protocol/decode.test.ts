import { expect, it } from 'vitest';

import { driverPrepareRequest } from '../testing/request.fixture.js';
import { driverPreparation } from '../testing/preparation.fixture.js';
import { decodeDriverPrepareRequest, decodeDriverPrepareResponse } from './decode.js';
import { DriverProtocolError } from './protocol-error.js';

it('decodes the versioned language-neutral request and response', () => {
  const request = driverPrepareRequest();
  expect(decodeDriverPrepareRequest(JSON.stringify(request))).toEqual(request);
  const response = {
    kind: 'driver-prepare-succeeded',
    protocolVersion: 1,
    driver: { kind: 'available', name: 'http-driver' },
    preparation: driverPreparation(),
  };
  expect(decodeDriverPrepareResponse(JSON.stringify(response))).toEqual(response);
});

it.each([
  ['request', '{', decodeDriverPrepareRequest],
  [
    'response',
    JSON.stringify({ kind: 'driver-prepare-succeeded', protocolVersion: 2 }),
    decodeDriverPrepareResponse,
  ],
] as const)('rejects an invalid %s document', (_label, document, decode) => {
  expect(() => decode(document)).toThrow(DriverProtocolError);
});

it.each([decodeDriverPrepareRequest, decodeDriverPrepareResponse])(
  'rejects malformed JSON without quoting any potentially secret input', (decode) => {
    expect(() => decode('private-target-secret-0123456789-abcdefghijklmnopqrstuvwxyz'))
      .toThrow('Invalid JSON in driver protocol input');
    try {
      decode('private-target-secret-0123456789-abcdefghijklmnopqrstuvwxyz');
    } catch (error) {
      expect(String(error)).not.toContain('private');
      return;
    }
    throw new Error('Expected invalid protocol input to fail');
  },
);
