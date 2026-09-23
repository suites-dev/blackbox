import assert from 'node:assert/strict';
import test from 'node:test';

import { requireFixtureControl } from './fixture-control-auth.js';

void test('fixture controls reject missing and wrong bearer credentials', () => {
  assert.throws(
    () => {
      requireFixtureControl(undefined, 'fixture-secret');
    },
    {
      code: 'fixture-control-unauthorized',
      status: 401,
    },
  );
  assert.throws(
    () => {
      requireFixtureControl('Bearer wrong-secret', 'fixture-secret');
    },
    {
      code: 'fixture-control-unauthorized',
      status: 401,
    },
  );
  assert.doesNotThrow(() => {
    requireFixtureControl('Bearer fixture-secret', 'fixture-secret');
  });
});

void test('fixture control configuration rejects empty and whitespace-only secrets', () => {
  for (const invalidToken of ['', ' ', '\t\n']) {
    assert.throws(
      () => {
        requireFixtureControl(`Bearer ${invalidToken}`, invalidToken);
      },
      {
        message: 'fixture control token must contain a non-whitespace secret',
      },
    );
  }
});
