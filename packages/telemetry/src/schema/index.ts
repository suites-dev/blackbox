export { default as telemetryExecutionScopeSchema } from './telemetry-execution-scope-v1.json' with { type: 'json' };
export { default as telemetryPropagationSchema } from './telemetry-propagation-v1.json' with { type: 'json' };

export const telemetryExecutionScopeSchemaUrl = new URL(
  './telemetry-execution-scope-v1.json',
  import.meta.url,
);

export const telemetryPropagationSchemaUrl = new URL(
  './telemetry-propagation-v1.json',
  import.meta.url,
);
