import assert from 'node:assert/strict';
import test from 'node:test';

import { requiredText } from './http.js';

void test('required identifiers reject empty and whitespace-only strings', () => {
  assert.throws(() => requiredText({ userId: '' }, 'userId'), { code: 'invalid-body' });
  assert.throws(() => requiredText({ userId: ' \t\n' }, 'userId'), { code: 'invalid-body' });
  assert.equal(requiredText({ userId: 'alice' }, 'userId'), 'alice');
});
