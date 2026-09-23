import assert from 'node:assert/strict';
import test from 'node:test';

import { DriverFence } from './driver-fence.mjs';

void test('fixture controls are fenced outside the measured operation', async () => {
  const fence = new DriverFence();
  assert.doesNotThrow(() => fence.assertFixtureControlAllowed());
  await fence.measure(async () => {
    assert.throws(() => fence.assertFixtureControlAllowed(), /forbidden/);
  });
  assert.doesNotThrow(() => fence.assertFixtureControlAllowed());
});
