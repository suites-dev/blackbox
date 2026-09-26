export {
  createTelemetryExecutionScope,
  createTelemetryExecutionScopeWithPorts,
} from './lifecycle/scope.js';
export type {
  CreateTelemetryExecutionScopeInput,
  TelemetryExecutionScope,
  TelemetryExecutionScopePorts,
} from './lifecycle/scope.js';
export type {
  ActiveTelemetryExecutionScopeRecord,
  CompletedTelemetryExecutionScopeRecord,
  TelemetryExecutionScopeRecord,
  TelemetryScopeResult,
} from './lifecycle/model.js';
export {
  injectW3CProcessEnvironment,
  injectW3CTextMap,
} from './propagation/carriers.js';
export type {
  InjectedProcessEnvironment,
  InjectedTextMapCarrier,
  InjectTextMapInput,
} from './propagation/carriers.js';
export { createTelemetryPropagationRecord } from './propagation/record.js';
export type {
  PropagationExpectation,
  PropagationOutcome,
  TelemetryPropagationRecord,
  W3CPropagationCarrier,
} from './propagation/model.js';
export type {
  W3CTraceContext,
  W3CTraceState,
} from './context/model.js';
export {
  telemetryExecutionScopeSchema,
  telemetryExecutionScopeSchemaUrl,
  telemetryPropagationSchema,
  telemetryPropagationSchemaUrl,
} from './schema/index.js';
