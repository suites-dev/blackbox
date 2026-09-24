export { startReportServer } from './http/server.js';
export { ensureReportServer } from './lifecycle/ensure.js';
export { DEFAULT_REPORT_PORT } from './model/identity.js';
export type {
  EnsureReportServerInput,
  EnsureReportServerResult,
  ReportServerIdentity,
} from './model/identity.js';
export { renderRegistryPage } from './ui/registry-page.js';
export type {
  ReportProvider,
  ReportSummary,
  ReportFailure,
  ReportListResult,
  ReportLoadResult,
  ReportArtifactResult,
  ReportClientView,
} from './model/provider.js';
export type {
  StartReportServerInput,
  ReportServer,
  ReportSelection,
  ReportRegistry,
} from './model/server.js';
export { default as reportRegistrySchema } from './schema/report-registry-v1.json' with { type: 'json' };
export { default as reportResponseSchema } from './schema/report-response-v1.json' with { type: 'json' };
export { default as reportServerIdentitySchema } from './schema/report-server-identity-v1.json' with { type: 'json' };
