export interface NodeTelemetryEnvironmentInput {
  readonly kind: 'node-telemetry-environment';
  readonly tracesEndpoint: string;
  readonly activationEndpoint: string;
  readonly authorizationToken: string;
  readonly sessionId: string;
  readonly executionId: string;
  readonly serviceName: string;
}

export interface NodeTelemetryEnvironment {
  readonly kind: 'node-telemetry-environment-variables';
  readonly variables: Readonly<Record<string, string>>;
}

function requireValue(input: { readonly name: string; readonly value: string }): string {
  if (input.value.trim() === '') {
    throw new Error(`${input.name} must be non-empty.`);
  }
  return input.value;
}

export function createNodeTelemetryEnvironment(
  input: NodeTelemetryEnvironmentInput,
): NodeTelemetryEnvironment {
  const token = requireValue({ name: 'authorizationToken', value: input.authorizationToken });
  return {
    kind: 'node-telemetry-environment-variables',
    variables: {
      BLACKBOX_OTEL_TRACES_ENDPOINT: requireValue({
        name: 'tracesEndpoint',
        value: input.tracesEndpoint,
      }),
      BLACKBOX_OTEL_ACTIVATION_ENDPOINT: requireValue({
        name: 'activationEndpoint',
        value: input.activationEndpoint,
      }),
      BLACKBOX_OTEL_AUTH_TOKEN: token,
      BLACKBOX_OTEL_SESSION_ID: requireValue({ name: 'sessionId', value: input.sessionId }),
      BLACKBOX_OTEL_EXECUTION_ID: requireValue({
        name: 'executionId',
        value: input.executionId,
      }),
      BLACKBOX_OTEL_SERVICE_NAME: requireValue({
        name: 'serviceName',
        value: input.serviceName,
      }),
      BLACKBOX_OTEL_RUNTIME: 'node',
      OTEL_SERVICE_NAME: input.serviceName,
      OTEL_TRACES_EXPORTER: 'otlp',
      OTEL_EXPORTER_OTLP_TRACES_PROTOCOL: 'http/json',
      OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: input.tracesEndpoint,
      OTEL_EXPORTER_OTLP_HEADERS: `authorization=Bearer ${token}`,
      OTEL_METRICS_EXPORTER: 'none',
      OTEL_LOGS_EXPORTER: 'none',
    },
  };
}
