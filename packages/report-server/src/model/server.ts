import type { ReportProvider, ReportSummary, ReportFailure } from './provider.js';

export type ReportSelection =
  | { kind: 'registry' }
  | { kind: 'report'; type: string; id: string };

export interface StartReportServerInput {
  kind: 'start-report-server';
  providers: readonly ReportProvider[];
  port: number;
  selection: ReportSelection;
}

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
