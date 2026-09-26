import { expect, it } from 'vitest';

import { snapshotContainerEnvironment } from './container-environment.js';

it('snapshots effective Docker environment using the first separator and final duplicate', () => {
  const inspection = {
    Config: { Env: ['EMPTY=', 'TOKEN=one=two', 'DUPLICATE=first', 'DUPLICATE=final'] },
  };
  const environment = snapshotContainerEnvironment(inspection);
  inspection.Config.Env[1] = 'TOKEN=changed';
  expect(environment).toEqual({ EMPTY: '', TOKEN: 'one=two', DUPLICATE: 'final' });
  expect(Object.isFrozen(environment)).toBe(true);
  expect(() => Object.assign(environment, { TOKEN: 'changed' })).toThrow();
});

it.each([
  [null, 'missing Config'],
  [[], 'missing Config'],
  [{ Config: null }, 'missing Config'],
  [{ Config: [] }, 'missing Config'],
  [{}, 'missing Config'],
  [{ Config: {} }, 'Config.Env must be an array'],
  [{ Config: { Env: null } }, 'Config.Env must be an array'],
  [{ Config: { Env: 'TOKEN=private' } }, 'Config.Env must be an array'],
  [{ Config: { Env: ['NO_SEPARATOR'] } }, 'Malformed Docker container environment entry'],
  [{ Config: { Env: ['=empty-name'] } }, 'Malformed Docker container environment entry'],
  [{ Config: { Env: [42] } }, 'Config.Env entries must be strings'],
])('rejects malformed Docker inspection data: %j', (inspection, message) => {
  expect(() => snapshotContainerEnvironment(inspection)).toThrow(message);
});

it('preserves prototype-like keys as immutable own values without changing the prototype', () => {
  const environment = snapshotContainerEnvironment({
    Config: { Env: ['__proto__=private', 'constructor=ctor', 'toString=value'] },
  });
  expect(Object.keys(environment)).toEqual(['__proto__', 'constructor', 'toString']);
  expect(Object.hasOwn(environment, '__proto__')).toBe(true);
  expect(environment.__proto__).toBe('private');
  expect(environment.constructor).toBe('ctor');
  expect(Reflect.get(environment, 'toString')).toBe('value');
  expect(Object.getPrototypeOf(environment)).toBe(Object.prototype);
  expect(Object.isFrozen(environment)).toBe(true);
});

it('keeps empty Docker environments empty and never includes malformed nested values in diagnostics', () => {
  expect(snapshotContainerEnvironment({ Config: { Env: [] } })).toEqual({});
  const secret = 'nested-private-value';
  expect(() => snapshotContainerEnvironment({ Config: { Env: [{ secret }] } }))
    .toThrow('Docker container inspection Config.Env entries must be strings');
});

it('does not serialize a malformed environment value into its error', () => {
  const secret = 'malformed-private-value';
  try {
    snapshotContainerEnvironment({ Config: { Env: [secret] } });
  } catch (error) {
    expect(error).toMatchObject({ message: 'Malformed Docker container environment entry at index 0' });
    expect(String(error)).not.toContain(secret);
    return;
  }
  throw new Error('Expected malformed Docker environment to be rejected');
});
