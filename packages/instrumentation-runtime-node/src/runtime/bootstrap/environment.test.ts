import { describe, expect, it } from 'vitest';
import { createNodeTelemetryEnvironment } from './environment.js';

const input = {
  kind: 'node-telemetry-environment',
  tracesEndpoint: 'http://collector:4318/v1/traces',
  activationEndpoint: 'http://collector:4318/v1/activation',
  authorizationToken: 'secret-token',
  sessionId: 'quiet-river-alex',
  executionId: 'execution-1',
  serviceName: 'orders-api',
} as const;

describe('Node telemetry environment', () => {
  it('binds the Blackbox identity and authenticated OTLP HTTP/json exporter', () => {
    expect(createNodeTelemetryEnvironment(input)).toEqual({
      kind: 'node-telemetry-environment-variables',
      variables: {
        BLACKBOX_OTEL_TRACES_ENDPOINT: 'http://collector:4318/v1/traces',
        BLACKBOX_OTEL_ACTIVATION_ENDPOINT: 'http://collector:4318/v1/activation',
        BLACKBOX_OTEL_AUTH_TOKEN: 'secret-token',
        BLACKBOX_OTEL_SESSION_ID: 'quiet-river-alex',
        BLACKBOX_OTEL_EXECUTION_ID: 'execution-1',
        BLACKBOX_OTEL_SERVICE_NAME: 'orders-api',
        BLACKBOX_OTEL_RUNTIME: 'node',
        OTEL_SERVICE_NAME: 'orders-api',
        OTEL_TRACES_EXPORTER: 'otlp',
        OTEL_EXPORTER_OTLP_TRACES_PROTOCOL: 'http/json',
        OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: 'http://collector:4318/v1/traces',
        OTEL_EXPORTER_OTLP_HEADERS: 'authorization=Bearer secret-token',
        OTEL_METRICS_EXPORTER: 'none',
        OTEL_LOGS_EXPORTER: 'none',
      },
    });
  });

  it.each([
    ['tracesEndpoint', { ...input, tracesEndpoint: '' }],
    ['activationEndpoint', { ...input, activationEndpoint: ' ' }],
    ['authorizationToken', { ...input, authorizationToken: '' }],
    ['sessionId', { ...input, sessionId: '' }],
    ['executionId', { ...input, executionId: '' }],
    ['serviceName', { ...input, serviceName: '' }],
  ] as const)('rejects an empty %s', (field, invalid) => {
    expect(() => createNodeTelemetryEnvironment(invalid)).toThrow(field);
  });
});
