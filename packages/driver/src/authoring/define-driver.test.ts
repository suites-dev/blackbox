import { expect, it } from 'vitest';

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
