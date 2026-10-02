export interface ReportServerIdentity {
  readonly kind: 'report-server-identity';
  readonly schemaVersion: 1;
  readonly scopeId: string;
  readonly providerTypes: readonly string[];
}
