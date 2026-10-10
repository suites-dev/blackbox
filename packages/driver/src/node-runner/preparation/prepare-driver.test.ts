import { expect, it } from 'vitest';

import { defineDriver } from '../../authoring/define-driver.js';
import { driverPreparation } from '../../testing/preparation.fixture.js';
import { driverPrepareRequest } from '../../testing/request.fixture.js';
import { prepareDriver } from './prepare-driver.js';

it('passes a frozen cloned request and wraps a validated preparation', async () => {
  const original = driverPrepareRequest();
  const driver = defineDriver({
    kind: 'project-driver',
    name: 'http-driver',
    prepare: (request) => {
      expect(request).not.toBe(original);
      expect(Object.isFrozen(request)).toBe(true);
      expect(Object.isFrozen(request.command.argv)).toBe(true);
      return driverPreparation();
    },
  });
  await expect(prepareDriver({ definition: driver, request: original })).resolves.toMatchObject({
    response: { kind: 'driver-prepare-succeeded', protocolVersion: 1 },
    preparation: { kind: 'prepared-command' },
  });
});

it('refuses a catalog id that does not match the authored driver name', async () => {
  const driver = defineDriver({
    kind: 'project-driver',
    name: 'other-driver',
    prepare: () => driverPreparation(),
  });
  await expect(prepareDriver({ definition: driver, request: driverPrepareRequest() })).rejects.toThrow(
    'does not match',
  );
});

it('refuses an authored preparation that removes the executable', async () => {
  const driver = defineDriver({
    kind: 'project-driver',
    name: 'http-driver',
    prepare: () => ({ ...driverPreparation(), argv: [] }),
  });
  await expect(prepareDriver({ definition: driver, request: driverPrepareRequest() })).rejects.toThrow(
    'argv must not be empty',
  );
});

it('lets a definition without a name serve every catalog key, passing each key to prepare()', async () => {
  const keys: string[] = [];
  const driver = defineDriver({
    kind: 'project-driver',
    prepare: (request) => {
      keys.push(request.driverId);
      return driverPreparation();
    },
  });
  for (const driverId of ['auth', 'Travel_HTTP.v2']) {
    await expect(
      prepareDriver({ definition: driver, request: { ...driverPrepareRequest(), driverId } }),
    ).resolves.toMatchObject({
      response: { kind: 'driver-prepare-succeeded', driver: { kind: 'available', name: driverId } },
    });
  }
  expect(keys).toEqual(['auth', 'Travel_HTTP.v2']);
});
