import assert from 'node:assert/strict';
import test from 'node:test';

test('the CI evidence wrapper preserves the real Node test result', () => {
  assert.notEqual(
    process.env.BLACKBOX_CI_PROOF_EXPECT_FAILURE,
    '1',
    'intentional negative control requested by ci-evidence-negative-control',
  );
});
