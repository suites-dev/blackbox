import type { ReportProvider } from './provider.js';
import type { ReportSelection, ReportServer } from './server.js';

export const DEFAULT_REPORT_PORT = 4310;

export interface ReportServerIdentity {
  readonly kind: 'report-server-identity';
  readonly schemaVersion: 1;
  readonly scopeId: string;
  readonly providerTypes: readonly string[];
}

export interface EnsureReportServerInput {
  readonly kind: 'ensure-report-server';
  readonly scopeId: string;
  readonly providers: readonly ReportProvider[];
  readonly port: number;
  readonly selection: ReportSelection;
}

export type EnsureReportServerResult =
  | { readonly kind: 'report-server-started'; readonly server: ReportServer }
  | {
      readonly kind: 'report-server-reused';
      readonly hostname: '127.0.0.1';
      readonly port: number;
      readonly url: string;
    };
