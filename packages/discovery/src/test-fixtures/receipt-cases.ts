import { receipt, type AuditDocument, type ReceiptDocument } from './audit.js';

export const receiptCases = [
  [
    'operable without execution',
    (a) => {
      a.execution = { kind: 'not-run', reason: 'not attempted' };
    },
    'operability.unsupported',
  ],
  [
    'readiness alone',
    (a) => {
      a.stages.terminal = { kind: 'not-run', reason: 'health only' };
    },
    'operability.unsupported',
  ],
  [
    'stimulus skipped',
    (a) => {
      a.stages.stimulus = { kind: 'not-required', reason: 'incorrect' };
    },
    'operability.unsupported',
  ],
  [
    'wrong accepted claim',
    (a) => {
      a.operability.claimId = 'different';
    },
    'claim.identity',
  ],
  [
    'missing catalog',
    (a) => {
      a.catalog = { kind: 'absent', reason: 'none' };
    },
    'catalog.missing',
  ],
  [
    'unsupported successful receipt',
    (a, r) => {
      r.receipts[1].result = { kind: 'exited', code: 1 };
    },
    'receipt.outcome',
  ],
  [
    'missing receipt',
    (a, r) => {
      r.receipts = [];
    },
    'receipt.missing',
  ],
  [
    'duplicate receipt',
    (a, r) => {
      r.receipts.push(r.receipts[0]);
    },
    'receipt.duplicate',
  ],
  [
    'wrong catalog digest',
    (a, r) => {
      r.receipts[0].scope.catalogDigest = '0'.repeat(64);
    },
    'receipt.scope',
  ],
  [
    'wrong revision',
    (a, r) => {
      r.receipts[0].scope.revision = 'other';
    },
    'receipt.scope',
  ],
  [
    'prior physical attempt',
    (a, r) => {
      r.receipts[1].scope.attemptId = 'old-attempt';
    },
    'receipt.scope',
  ],
  [
    'prior Capsule',
    (a, r) => {
      r.receipts[1].scope.capsuleId = 'old-capsule';
    },
    'receipt.scope',
  ],
  [
    'unrecorded activity',
    (a, r) => {
      receipt(r, 'terminal').activity.id = 'old-activity';
    },
    'receipt.activity',
  ],
  [
    'stale output message',
    (a, r) => {
      receipt(r, 'terminal').businessId = 'old-message';
    },
    'witness.mismatch',
  ],
  [
    'wrong terminal node',
    (a, r) => {
      receipt(r, 'terminal').nodeId = 'api';
    },
    'witness.missing',
  ],
  [
    'partial observation',
    (a, r) => {
      receipt(r, 'observation').result = 'partial';
    },
    'receipt.outcome',
  ],
  [
    'missing observation participant',
    (a, r) => {
      receipt(r, 'observation').nodeIds = ['api'];
    },
    'observation.missing',
  ],
  [
    'leaked owned resources',
    (a, r) => {
      receipt(r, 'cleanup').remainingOwnedIds = ['leftover'];
    },
    'receipt.outcome',
  ],
  [
    'complete with failed cleanup',
    (a) => {
      a.stages.cleanup = { kind: 'failed', reason: 'leftover', receiptIds: ['r-cleanup'] };
    },
    'outcome.incomplete',
  ],
  [
    'runtime assertion without receipt',
    (a) => {
      a.evidence.push({
        kind: 'runtime',
        id: 'r-evidence',
        assertion: 'claimed observation',
        receiptId: 'absent',
      });
    },
    'evidence.receipt',
  ],
] satisfies readonly (readonly [
  string,
  (audit: AuditDocument, receipts: ReceiptDocument) => void,
  string,
])[];
