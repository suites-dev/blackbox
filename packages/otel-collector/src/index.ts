export { readCollectorSession, readCollectorTrace } from './storage/reader.js';
export { collectorFragmentSchema, collectorLifecycleSchema } from './schema/index.js';
export { startCollector } from './transport/server.js';
export type {
  CollectorCloseResult,
  CollectorEndpoint,
  CollectorFailure,
  CollectorHandle,
  CollectorIdentity,
  CollectorLifecycleRecord,
  CollectorSessionReadResult,
  CollectorStatus,
  CollectorTelemetryStatus,
  CollectorTraceReadResult,
  ReadCollectorSessionInput,
  ReadCollectorTraceInput,
  StartCollectorInput,
  TraceFragment,
} from './model/types.js';
