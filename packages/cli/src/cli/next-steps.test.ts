import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import test from 'node:test';
import { promisify } from 'node:util';

import { nextSteps, shellArgument } from './next-steps.js';

const execute = promisify(execFile);
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

void test('a readiness URL with shell metacharacters is single-quoted in both forms', () => {
  const readinessUrl = 'http://127.0.0.1:5000/ready?a=1&b=2';
  assert.equal(
    nextSteps.run({ capsule: CAPSULE, driver: null, readinessUrl }),
    `blackbox run --capsule ${CAPSULE} -- curl 'http://127.0.0.1:5000/ready?a=1&b=2'`,
  );
  assert.equal(
    nextSteps.run({ capsule: CAPSULE, driver: 'public-api', readinessUrl }),
    `blackbox run --capsule ${CAPSULE} --via public-api -- curl '/ready?a=1&b=2'`,
  );
});

void test('shellArgument round-trips through a real shell for hostile values', async () => {
  for (const value of ['/ready?a=1&b=2', '/x;echo pwned', "it's", '/a b', '$(id)', '/plain']) {
    const { stdout } = await execute('sh', ['-c', `printf %s ${shellArgument(value)}`]);
    assert.equal(stdout, value);
  }
});
