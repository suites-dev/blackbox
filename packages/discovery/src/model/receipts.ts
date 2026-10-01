/** A receipt belongs to a particular source revision and selected catalog content. */
export type ReceiptScope =
  | Readonly<{ kind: 'project'; revision: string; catalogDigest: string }>
  | Readonly<{
      kind: 'capsule';
      revision: string;
      catalogDigest: string;
      capsuleId: string;
      attemptId: string;
    }>;

export type ProcessResult =
  | Readonly<{ kind: 'exited'; code: number }>
  | Readonly<{ kind: 'signaled'; signal: string }>
  | Readonly<{ kind: 'tool-failed'; reason: string }>;

type ReceiptIdentity = Readonly<{
  id: string;
  scope: ReceiptScope;
  artifact: string;
  digest: string;
  activity:
    | Readonly<{ kind: 'recorded'; id: string }>
    | Readonly<{ kind: 'not-applicable'; reason: string }>;
}>;

export type Receipt = ReceiptIdentity &
  (
    | Readonly<{
        kind: 'command';
        phase: 'catalog' | 'acquisition' | 'readiness' | 'setup' | 'stimulus';
        argv: readonly string[];
        result: ProcessResult;
      }>
    | Readonly<{
        kind: 'terminal';
        claimId: string;
        nodeId: string;
        businessId: string;
        result: 'observed' | 'not-observed';
      }>
    | Readonly<{
        kind: 'observation';
        nodeIds: readonly string[];
        traceIds: readonly string[];
        result: 'captured' | 'partial' | 'unavailable';
      }>
    | Readonly<{
        kind: 'cleanup';
        result: 'released' | 'failed';
        releasedIds: readonly string[];
        remainingOwnedIds: readonly string[];
      }>
  );

/** Authentication of runner records is the caller's responsibility, not a JSON field. */
export type ReceiptBundle = Readonly<{
  schemaVersion: 1;
  kind: 'receipt-bundle';
  provenance:
    | Readonly<{ kind: 'example'; description: string }>
    | Readonly<{ kind: 'runner'; issuer: string }>;
  receipts: readonly Receipt[];
}>;
