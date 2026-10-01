import { test } from 'vitest';
import assert from 'node:assert/strict';
import { validateAudit, validateInspectorResult } from '../index.js';
import { example, mutate } from '../test-fixtures/audit.js';
import { auditCases } from '../test-fixtures/audit-cases.js';

for (const name of ['http', 'queue', 'blocked']) {
  test(`accepts the ${name} illustrative contract, not runtime proof`, () => {
    const { audit, receipts } = example(name);
    assert.deepEqual(validateAudit(audit, receipts), {
      kind: 'accepted',
      qualification: 'structure-and-receipt-links-only',
      provenance: 'example',
    });
  });
}

for (const [name, change, code] of auditCases) {
  test(`rejects ${name}`, () => {
    mutate(change, code);
  });
}

test('retains demonstrated operability while separately reporting failed cleanup', () => {
  const { audit, receipts } = example();
  audit.stages.cleanup = { kind: 'failed', reason: 'resource left', receiptIds: ['r-cleanup'] };
  audit.outcome = { kind: 'failed', reasons: ['cleanup failed'] };
  const cleanup = receipts.receipts.find((x) => x.kind === 'cleanup');
  assert.ok(cleanup);
  cleanup.result = 'failed';
  cleanup.remainingOwnedIds = ['owned-leftover'];
  assert.equal(validateAudit(audit, receipts).kind, 'accepted');
});

test('accepts a static preflight without claiming runtime operability', () => {
  const { audit, receipts } = example();
  audit.task = { kind: 'preflight' };
  audit.execution = { kind: 'not-run', reason: 'static only' };
  audit.operability = { kind: 'not-assessed', reason: 'static only' };
  for (const name of Object.keys(audit.stages as Record<string, unknown>)) {
    if (name !== 'catalog') {
      audit.stages[name] = { kind: 'not-run', reason: 'static only' };
    }
  }
  receipts.receipts = receipts.receipts.filter((x) => x.id === 'r-catalog');
  assert.equal(validateAudit(audit, receipts).kind, 'accepted');
});

test('inspector contracts accept blocked results and reject invented graph fields', () => {
  const result = {
    schemaVersion: 1,
    inspector: 'node',
    version: '1',
    kind: 'blocked',
    reasons: ['tool missing'],
  };
  assert.deepEqual(validateInspectorResult(result), []);
  assert.equal(validateInspectorResult({ ...result, graph: {} })[0].code, 'schema.invalid');
});
