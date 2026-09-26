import type { SandboxTelemetryEnabledInput, SandboxTelemetryParticipant } from '../types.js';

export const COLLECTOR_TRACES_PATH = '/v1/traces';
export const COLLECTOR_ACTIVATION_PATH = '/v1/activation';
export const COLLECTOR_STATUS_PATH = '/status';

export function collectorInternalUrl(input: SandboxTelemetryEnabledInput): string {
  return `http://${input.collector.service}:${input.collector.containerPort}`;
}

export function collectorEnvironment(
  input: SandboxTelemetryEnabledInput,
  authorization: {
    readonly kind: 'split-bearer-tokens';
    readonly ingestToken: string;
    readonly controlToken: string;
  },
): Readonly<Record<string, string>> {
  return Object.freeze({
    ...input.collector.environment,
    BLACKBOX_OTEL_SESSION_ID: input.sessionId,
    BLACKBOX_OTEL_EXECUTION_ID: input.executionId,
    BLACKBOX_OTEL_HOST: '0.0.0.0',
    BLACKBOX_OTEL_PORT: String(input.collector.containerPort),
    BLACKBOX_OTEL_TRACES_PATH: COLLECTOR_TRACES_PATH,
    BLACKBOX_OTEL_ACTIVATION_PATH: COLLECTOR_ACTIVATION_PATH,
    BLACKBOX_OTEL_READINESS_PATH: input.collector.readiness.path,
    BLACKBOX_OTEL_READ_PATH: COLLECTOR_STATUS_PATH,
    BLACKBOX_OTEL_INGEST_TOKEN: authorization.ingestToken,
    BLACKBOX_OTEL_CONTROL_TOKEN: authorization.controlToken,
    BLACKBOX_OTEL_STORAGE_DIRECTORY: '/blackbox/telemetry',
  });
}

export function participantEnvironment(input: {
  readonly telemetry: SandboxTelemetryEnabledInput;
  readonly participant: SandboxTelemetryParticipant;
  readonly ingestToken: string;
  readonly effectiveEnvironment: Readonly<Record<string, string>>;
}): Readonly<Record<string, string>> {
  const baseUrl = collectorInternalUrl(input.telemetry);
  const tracesEndpoint = `${baseUrl}${COLLECTOR_TRACES_PATH}`;
  const activation = input.participant.activation;
  const inherited =
    activation.kind === 'append-environment-variable' &&
    Object.hasOwn(input.effectiveEnvironment, activation.name)
      ? input.effectiveEnvironment[activation.name]
      : '';
  const activationEnvironment =
    activation.kind === 'none'
      ? {}
      : {
          [activation.name]: [inherited, activation.value]
            .filter((value) => value.trim() !== '')
            .join(' '),
        };
  return Object.freeze({
    ...input.participant.environment,
    ...activationEnvironment,
    BLACKBOX_OTEL_TRACES_ENDPOINT: tracesEndpoint,
    BLACKBOX_OTEL_ACTIVATION_ENDPOINT: `${baseUrl}${COLLECTOR_ACTIVATION_PATH}`,
    BLACKBOX_OTEL_AUTH_TOKEN: input.ingestToken,
    BLACKBOX_OTEL_SESSION_ID: input.telemetry.sessionId,
    BLACKBOX_OTEL_EXECUTION_ID: input.telemetry.executionId,
    BLACKBOX_OTEL_SERVICE_NAME: input.participant.service,
    BLACKBOX_OTEL_RUNTIME: input.participant.runtime,
    OTEL_SERVICE_NAME: input.participant.service,
    OTEL_TRACES_EXPORTER: 'otlp',
    OTEL_EXPORTER_OTLP_TRACES_PROTOCOL: 'http/json',
    OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: tracesEndpoint,
    OTEL_EXPORTER_OTLP_HEADERS: `authorization=Bearer ${input.ingestToken}`,
    OTEL_METRICS_EXPORTER: 'none',
    OTEL_LOGS_EXPORTER: 'none',
  });
}
