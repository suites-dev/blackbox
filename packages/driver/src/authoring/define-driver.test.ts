import { expect, it } from 'vitest';

import { driverPreparation } from '../testing/preparation.fixture.js';
import { defineDriver, InvalidDriverDefinitionError } from './define-driver.js';

it('requires a stable slug name and freezes the definition', () => {
  const driver = defineDriver({
    kind: 'project-driver',
    name: 'postgres-driver',
    prepare: () => ({
      kind: 'prepared-command',
      argv: ['psql'],
      environment: {},
      propagation: {
        kind: 'context-not-supported',
        boundary: 'shared-state',
        resource: 'postgresql',
      },
      redaction: {
        kind: 'driver-redaction',
        requestArgv: { kind: 'none' },
        preparedArgv: { kind: 'none' },
        environment: { kind: 'none' },
      },
    }),
  });
  expect(Object.isFrozen(driver)).toBe(true);
  expect(() => defineDriver({ ...driver, name: 'Postgres Driver' })).toThrow(
    InvalidDriverDefinitionError,
  );
});

it('accepts a definition without a name and still refuses a blank one', () => {
  const prepare = () => driverPreparation();
  expect(Object.isFrozen(defineDriver({ kind: 'project-driver', prepare }))).toBe(true);
  expect(() => defineDriver({ kind: 'project-driver', name: '', prepare })).toThrow(
    InvalidDriverDefinitionError,
  );
});
