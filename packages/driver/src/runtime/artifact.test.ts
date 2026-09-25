import { expect, it } from 'vitest';

import { driverRuntimeSchema, driverRuntimeSchemaUrl } from '../schema/driver-schemas.js';
import {
  decodeDriverRuntimeArtifact,
  DriverRuntimeArtifactError,
  nodeDriverRuntimeArtifact,
  validateDriverRuntimeArtifact,
} from './artifact.js';

it('validates the canonical Node runtime artifact', () => {
  expect(validateDriverRuntimeArtifact(nodeDriverRuntimeArtifact)).toEqual({
    schemaVersion: 1,
    kind: 'blackbox-driver-runtime',
    runtime: 'node',
  });
  expect(decodeDriverRuntimeArtifact(JSON.stringify(nodeDriverRuntimeArtifact))).toEqual(
    nodeDriverRuntimeArtifact,
  );
});

it('rejects unknown fields and unsupported runtime variants', () => {
  expect(() =>
    validateDriverRuntimeArtifact({ ...nodeDriverRuntimeArtifact, futureField: true }),
  ).toThrow(/additional properties/u);
  expect(() =>
    validateDriverRuntimeArtifact({ ...nodeDriverRuntimeArtifact, runtime: 'python' }),
  ).toThrow(DriverRuntimeArtifactError);
});

it('classifies malformed JSON as an artifact error', () => {
  expect(() => decodeDriverRuntimeArtifact('{')).toThrow(/artifact JSON/u);
});

it('exports the exact runtime schema and URL', () => {
  expect(driverRuntimeSchemaUrl.href).toMatch(/schema\/driver-runtime-v1\.json$/u);
  expect(driverRuntimeSchema).toMatchObject({
    $id: 'https://schemas.suites.dev/blackbox/driver-runtime/v1',
    additionalProperties: false,
  });
});
