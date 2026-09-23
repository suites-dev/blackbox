export interface ReportSummary {
  kind: 'report-summary';
  id: string;
  type: string;
  title: string;
  description:
    | { kind: 'available'; value: string }
    | { kind: 'unavailable' };
  state: string;
  createdAt: string;
}

export interface ReportFailure {
  kind: 'report-failure';
  code: 'not-found' | 'invalid-request' | 'artifact-unavailable' | 'provider-error';
  message: string;
}

export type ReportListResult =
  | { kind: 'report-list'; reports: readonly ReportSummary[] }
  | ReportFailure;

export type ReportLoadResult =
  | { kind: 'report-document'; document: unknown }
  | ReportFailure;

export type ReportArtifactResult =
  | { kind: 'report-artifact'; artifact: string; document: unknown }
  | ReportFailure;

export interface ReportClientView {
  readonly kind: 'report-client-view';
  readonly styles: string;
  readonly script: string;
}

/** Providers own validation, redaction, and the artifact-name allowlist. */
export interface ReportProvider {
  kind: 'report-provider';
  type: string;
  view: ReportClientView;
  list(input: { kind: 'list-reports' }): Promise<ReportListResult>;
  load(input: { kind: 'load-report'; id: string }): Promise<ReportLoadResult>;
  artifact(input: {
    kind: 'load-artifact'; id: string; artifact: string;
  }): Promise<ReportArtifactResult>;
  render(input: { kind: 'render-report'; document: unknown }): string;
}
