import assert from 'node:assert/strict';
import test from 'node:test';

import { nextSteps } from './next-steps.js';

const CAPSULE = 'calm-comet-ada-000000000001';

void test('the run suggestion uses the probed readiness URL, never raw path concatenation', () => {
  // A catalog path `health` is resolved by acquisition to …:5000/health.
  const readinessUrl = new URL('health', 'http://127.0.0.1:5000/').toString();
  assert.equal(
    nextSteps.run({ capsule: CAPSULE, driver: null, readinessUrl }),
    `blackbox run --capsule ${CAPSULE} -- curl http://127.0.0.1:5000/health`,
  );
  assert.equal(
    nextSteps.run({ capsule: CAPSULE, driver: 'public-api', readinessUrl }),
    `blackbox run --capsule ${CAPSULE} --via public-api -- curl /health`,
  );
});

void test('a readiness query string survives in both forms', () => {
  const readinessUrl = 'http://127.0.0.1:5000/ready?deep=1';
  assert.equal(
    nextSteps.run({ capsule: CAPSULE, driver: null, readinessUrl }),
    `blackbox run --capsule ${CAPSULE} -- curl ${readinessUrl}`,
  );
  assert.equal(
    nextSteps.run({ capsule: CAPSULE, driver: 'public-api', readinessUrl }),
    `blackbox run --capsule ${CAPSULE} --via public-api -- curl /ready?deep=1`,
  );
});
