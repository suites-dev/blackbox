import type { AuditDocument, ReceiptDocument } from './audit.js';

export const graphCases = [
  [
    'unknown variant',
    (a) => {
      a.kind = 'working';
    },
    'schema.invalid',
  ],
  [
    'missing required property',
    (a) => {
      delete a.execution;
    },
    'schema.invalid',
  ],
  [
    'secret value in environment',
    (a) => {
      a.environment.push({
        name: 'PASSWORD',
        kind: 'secret-reference',
        reference: 'secret-store/key',
        availability: 'present',
        consumers: ['api'],
        evidenceIds: ['src-1'],
        value: 'must-not-be-retained',
      });
    },
    'schema.invalid',
  ],
  [
    'nonlocal source path',
    (a) => {
      a.evidence[0].path = '../outside';
    },
    'schema.invalid',
  ],
  [
    'absolute receipt path',
    (a, r) => {
      r.receipts[0].artifact = '/private/data';
    },
    'schema.invalid',
  ],
  [
    'duplicate node',
    (a) => {
      a.graph.nodes.push(a.graph.nodes[0]);
    },
    'identity.duplicate',
  ],
  [
    'dangling graph edge',
    (a) => {
      a.graph.edges[0].to = 'missing';
    },
    'graph.dangling',
  ],
  [
    'missing provenance',
    (a) => {
      a.graph.nodes[0].evidenceIds = ['missing'];
    },
    'evidence.missing',
  ],
  [
    'missing confidence provenance',
    (a) => {
      a.boundary.confidence.evidenceIds = ['missing'];
    },
    'evidence.missing',
  ],
  [
    'stale source revision',
    (a) => {
      a.evidence[0].revision = 'old';
    },
    'evidence.stale',
  ],
  [
    'circular inference',
    (a) => {
      a.evidence.push({
        kind: 'inference',
        id: 'loop',
        assertion: 'circular',
        basedOn: ['loop'],
        reason: 'invalid',
      });
    },
    'evidence.circular',
  ],
  [
    'unapproved repository read',
    (a) => {
      a.evidence[0].repository = 'other/repo';
    },
    'approval.repository',
  ],
  [
    'omitted required participant',
    (a) => {
      a.boundary.nodeIds = ['api', 'postgres'];
    },
    'boundary.open',
  ],
  [
    'high confidence with unknown prerequisite',
    (a) => {
      a.boundary.confidence.kind = 'high';
      a.graph.edges[2].necessity = 'unknown';
    },
    'boundary.uncertain',
  ],
  [
    'high confidence without evidence',
    (a) => {
      a.boundary.confidence.kind = 'high';
      a.boundary.confidence.evidenceIds = [];
    },
    'boundary.unsupported-confidence',
  ],
  [
    'unapproved substitution',
    (a) => {
      a.boundary.substitutions.push({
        original: 'billing',
        replacement: 'api',
        approvalId: 'none',
        preserves: ['example'],
        limitations: ['unvalidated substitute'],
      });
    },
    'boundary.substitution',
  ],
] satisfies readonly (readonly [
  string,
  (audit: AuditDocument, receipts: ReceiptDocument) => void,
  string,
])[];
