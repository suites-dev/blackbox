import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateAudit, validateInspectorResult } from '../dist/src/index.js';
import { example, mutate } from './support.mjs';

for (const name of ['http', 'queue', 'blocked']) {
  test(`accepts the ${name} illustrative contract, not runtime proof`, () => {
    const { audit, receipts } = example(name);
    assert.deepEqual(validateAudit(audit, receipts), {
      kind: 'accepted', qualification: 'structure-and-receipt-links-only', provenance: 'example',
    });
  });
}

const cases = [
  ['unknown variant', (a) => { a.kind = 'working'; }, 'schema.invalid'],
  ['missing required property', (a) => { delete a.execution; }, 'schema.invalid'],
  ['secret value in environment', (a) => { a.environment.push({
    name: 'PASSWORD', kind: 'secret-reference', reference: 'secret-store/key', availability: 'present',
    consumers: ['api'], evidenceIds: ['src-1'], value: 'must-not-be-retained',
  }); }, 'schema.invalid'],
  ['nonlocal source path', (a) => { a.evidence[0].path = '../outside'; }, 'schema.invalid'],
  ['absolute receipt path', (a, r) => { r.receipts[0].artifact = '/private/data'; }, 'schema.invalid'],
  ['duplicate node', (a) => { a.graph.nodes.push(a.graph.nodes[0]); }, 'identity.duplicate'],
  ['dangling graph edge', (a) => { a.graph.edges[0].to = 'missing'; }, 'graph.dangling'],
  ['missing provenance', (a) => { a.graph.nodes[0].evidenceIds = ['missing']; }, 'evidence.missing'],
  ['missing confidence provenance', (a) => { a.boundary.confidence.evidenceIds = ['missing']; }, 'evidence.missing'],
  ['stale source revision', (a) => { a.evidence[0].revision = 'old'; }, 'evidence.stale'],
  ['circular inference', (a) => { a.evidence.push({ kind: 'inference', id: 'loop', assertion: 'circular', basedOn: ['loop'], reason: 'invalid' }); }, 'evidence.circular'],
  ['unapproved repository read', (a) => { a.evidence[0].repository = 'other/repo'; }, 'approval.repository'],
  ['omitted required participant', (a) => { a.boundary.nodeIds = ['api', 'postgres']; }, 'boundary.open'],
  ['high confidence with unknown prerequisite', (a) => { a.boundary.confidence.kind = 'high'; a.graph.edges[2].necessity = 'unknown'; }, 'boundary.uncertain'],
  ['high confidence without evidence', (a) => { a.boundary.confidence.kind = 'high'; a.boundary.confidence.evidenceIds = []; }, 'boundary.unsupported-confidence'],
  ['unapproved substitution', (a) => { a.boundary.substitutions.push({ original: 'billing', replacement: 'api', approvalId: 'none', preserves: ['example'], limitations: ['unvalidated substitute'] }); }, 'boundary.substitution'],
  ['operable without execution', (a) => { a.execution = { kind: 'not-run', reason: 'not attempted' }; }, 'operability.unsupported'],
  ['readiness alone', (a) => { a.stages.terminal = { kind: 'not-run', reason: 'health only' }; }, 'operability.unsupported'],
  ['stimulus skipped', (a) => { a.stages.stimulus = { kind: 'not-required', reason: 'incorrect' }; }, 'operability.unsupported'],
  ['wrong accepted claim', (a) => { a.operability.claimId = 'different'; }, 'claim.identity'],
  ['missing catalog', (a) => { a.catalog = { kind: 'absent', reason: 'none' }; }, 'catalog.missing'],
  ['unsupported successful receipt', (a, r) => { r.receipts[1].result = { kind: 'exited', code: 1 }; }, 'receipt.outcome'],
  ['missing receipt', (a, r) => { r.receipts = []; }, 'receipt.missing'],
  ['duplicate receipt', (a, r) => { r.receipts.push(r.receipts[0]); }, 'receipt.duplicate'],
  ['wrong catalog digest', (a, r) => { r.receipts[0].scope.catalogDigest = '0'.repeat(64); }, 'receipt.scope'],
  ['wrong revision', (a, r) => { r.receipts[0].scope.revision = 'other'; }, 'receipt.scope'],
  ['prior physical attempt', (a, r) => { r.receipts[1].scope.attemptId = 'old-attempt'; }, 'receipt.scope'],
  ['prior Capsule', (a, r) => { r.receipts[1].scope.capsuleId = 'old-capsule'; }, 'receipt.scope'],
  ['unrecorded activity', (a, r) => { r.receipts.find((x) => x.kind === 'terminal').activity.id = 'old-activity'; }, 'receipt.activity'],
  ['stale output message', (a, r) => { r.receipts.find((x) => x.kind === 'terminal').businessId = 'old-message'; }, 'witness.mismatch'],
  ['wrong terminal node', (a, r) => { r.receipts.find((x) => x.kind === 'terminal').nodeId = 'api'; }, 'witness.missing'],
  ['partial observation', (a, r) => { r.receipts.find((x) => x.kind === 'observation').result = 'partial'; }, 'receipt.outcome'],
  ['missing observation participant', (a, r) => { r.receipts.find((x) => x.kind === 'observation').nodeIds = ['api']; }, 'observation.missing'],
  ['leaked owned resources', (a, r) => { r.receipts.find((x) => x.kind === 'cleanup').remainingOwnedIds = ['leftover']; }, 'receipt.outcome'],
  ['complete with failed cleanup', (a) => { a.stages.cleanup = { kind: 'failed', reason: 'leftover', receiptIds: ['r-cleanup'] }; }, 'outcome.incomplete'],
  ['runtime assertion without receipt', (a) => { a.evidence.push({ kind: 'runtime', id: 'r-evidence', assertion: 'claimed observation', receiptId: 'absent' }); }, 'evidence.receipt'],
];

for (const [name, change, code] of cases) {
  test(`rejects ${name}`, () => mutate(change, code));
}

test('retains demonstrated operability while separately reporting failed cleanup', () => {
  const { audit, receipts } = example();
  audit.stages.cleanup = { kind: 'failed', reason: 'resource left', receiptIds: ['r-cleanup'] };
  audit.outcome = { kind: 'failed', reasons: ['cleanup failed'] };
  const cleanup = receipts.receipts.find((x) => x.kind === 'cleanup');
  cleanup.result = 'failed';
  cleanup.remainingOwnedIds = ['owned-leftover'];
  assert.equal(validateAudit(audit, receipts).kind, 'accepted');
});

test('accepts a static preflight without claiming runtime operability', () => {
  const { audit, receipts } = example();
  audit.task = { kind: 'preflight' };
  audit.execution = { kind: 'not-run', reason: 'static only' };
  audit.operability = { kind: 'not-assessed', reason: 'static only' };
  for (const name of Object.keys(audit.stages)) {
    if (name !== 'catalog') audit.stages[name] = { kind: 'not-run', reason: 'static only' };
  }
  receipts.receipts = receipts.receipts.filter((x) => x.id === 'r-catalog');
  assert.equal(validateAudit(audit, receipts).kind, 'accepted');
});

test('inspector contracts accept blocked results and reject invented graph fields', () => {
  const result = { schemaVersion: 1, inspector: 'node', version: '1', kind: 'blocked', reasons: ['tool missing'] };
  assert.deepEqual(validateInspectorResult(result), []);
  assert.equal(validateInspectorResult({ ...result, graph: {} })[0].code, 'schema.invalid');
});
