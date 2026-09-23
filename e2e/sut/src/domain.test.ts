import assert from 'node:assert/strict';
import test from 'node:test';

import { hintProfileFor, isLocalOnlyUser, seedUsers } from './domain.js';

void test('seed users expose the exact deterministic actor set', () => {
  assert.deepEqual(
    seedUsers.map(({ userId }) => userId),
    ['alice', 'bob', 'carol', 'dora', 'eve'],
  );
  assert.deepEqual(
    seedUsers.map(({ tier }) => tier),
    ['pro', 'pro', 'pro', 'pro', 'pro'],
  );
});

void test('only comparison actors use the local-only path', () => {
  assert.equal(isLocalOnlyUser('alice'), false);
  assert.equal(isLocalOnlyUser('bob'), false);
  assert.equal(isLocalOnlyUser('carol'), false);
  assert.equal(isLocalOnlyUser('dora'), true);
  assert.equal(isLocalOnlyUser('eve'), true);
});

void test('fraud hint profiles are stable', () => {
  assert.equal(hintProfileFor('alice'), 'long');
  assert.equal(hintProfileFor('bob'), 'short');
  assert.equal(hintProfileFor('carol'), 'long');
  assert.equal(hintProfileFor('ghost-user'), 'long');
});
