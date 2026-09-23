import assert from 'node:assert/strict';
import test from 'node:test';

import { FraudAssessmentService } from './assessment.js';

void test('assessment waits for its owned audit write and returns the stable hint', async () => {
  let releaseWrite: (() => void) | undefined;
  const written: unknown[] = [];
  const service = new FraudAssessmentService({
    async record(input) {
      written.push(input);
      await new Promise<void>((resolve) => {
        releaseWrite = resolve;
      });
    },
  });
  let settled = false;
  const assessment = service.assess('bob').then((value) => {
    settled = true;
    return value;
  });
  await Promise.resolve();
  assert.equal(settled, false);
  assert.deepEqual(written, [{ userId: 'bob', decision: 'approved', hintProfile: 'short' }]);
  if (releaseWrite === undefined) {
    assert.fail('audit write was not started');
  }
  releaseWrite();
  assert.deepEqual(await assessment, {
    decision: 'approved',
    hintProfile: 'short',
    userId: 'bob',
  });
});
