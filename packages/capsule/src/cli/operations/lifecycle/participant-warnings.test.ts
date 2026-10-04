import assert from 'node:assert/strict';
import test from 'node:test';

import { participantExitText } from './participant-warnings.js';

const identity = { participant: 'db', service: 'orders-db', containerName: 'orders-db-1' };

void test('participant exit text names the participant, its service and how it ended', () => {
  assert.equal(
    participantExitText({ ...identity, state: 'exited', exitCode: 137 }),
    'participant db (orders-db) exited with code 137',
  );
  assert.equal(
    participantExitText({ ...identity, state: 'dead', exitCode: null }),
    'participant db (orders-db) is dead',
  );
  assert.equal(
    participantExitText({ ...identity, state: 'missing', exitCode: null }),
    'participant db (orders-db) is gone: its container orders-db-1 no longer exists',
  );
});
