/** An assertion has provenance. Inference is never silently promoted to a runtime fact. */
export type Evidence =
  | Readonly<{
      kind: 'source'; id: string; repository: string; revision: string;
      path: string; locator: string; assertion: string;
    }>
  | Readonly<{
      kind: 'inference'; id: string; assertion: string;
      basedOn: ReadonlyArray<string>; reason: string;
    }>
  | Readonly<{
      kind: 'runtime'; id: string; assertion: string; receiptId: string;
    }>
  | Readonly<{
      kind: 'unresolved'; id: string; assertion: string; reason: string;
    }>;

export type Action =
  | 'read-repository' | 'fetch-remote' | 'execute-code'
  | 'manage-local-resources' | 'write-project' | 'write-ci'
  | 'access-external-service' | 'substitute-dependency';

/** Scope is an exact repository, project or service identifier, not an implicit wildcard. */
export type Approval = Readonly<{
  id: string; action: Action; scope: string; requestedAt: string;
}> & (
  | Readonly<{ kind: 'approved'; approvedBy: string; expiresAt: string }>
  | Readonly<{ kind: 'denied'; reason: string }>
  | Readonly<{ kind: 'pending'; reason: string }>
);

/** An environment variable's value does not belong in the discovery audit. */
export type EnvironmentInput = Readonly<{
  name: string; evidenceIds: ReadonlyArray<string>; consumers: ReadonlyArray<string>;
}> & (
  | Readonly<{ kind: 'configuration'; source: string; availability: 'present' | 'missing' | 'unknown' }>
  | Readonly<{ kind: 'secret-reference'; reference: string; availability: 'present' | 'missing' | 'unknown' }>
  | Readonly<{ kind: 'unknown'; reason: string }>
);
