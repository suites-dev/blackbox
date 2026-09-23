import type { ReportProvider, ReportSummary, ReportFailure } from './provider.js';
import type { ReportServerIdentity } from './identity.js';

export type ReportSelection =
  | { kind: 'registry' }
  | { kind: 'report'; type: string; id: string };

interface ReportServerConfiguration {
  providers: readonly ReportProvider[];
  port: number;
  selection: ReportSelection;
}

export type StartReportServerInput = ReportServerConfiguration & (
  | { kind: 'start-report-server' }
  | { kind: 'start-scoped-report-server'; identity: ReportServerIdentity }
);

export interface ReportServer {
  kind: 'report-server';
  hostname: '127.0.0.1';
  port: number;
  url: string;
  close(): Promise<void>;
}

export interface ReportRegistry {
  kind: 'report-registry';
  schemaVersion: 1;
  reports: readonly ReportSummary[];
  failures: readonly { type: string; failure: ReportFailure }[];
}
