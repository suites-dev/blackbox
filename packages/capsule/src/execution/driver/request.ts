import type { DriverPrepareRequest } from '@suites/blackbox-driver';
import type { ResolvedCatalogDriver } from '@suites/blackbox-catalog-internal';
import type { SandboxHandle } from '@suites/blackbox-sandbox-internal';
import type { TelemetryExecutionScope } from '@suites/blackbox-telemetry-internal';

function driverEndpointName(driverId: string): string {
  return `driver-${driverId}`;
}

function execution(driver: ResolvedCatalogDriver): DriverPrepareRequest['execution'] {
  return driver.execution.kind === 'host'
    ? { kind: 'host' }
    : {
        kind: 'participant',
        participantId: driver.execution.participantId,
        service: driver.execution.service,
      };
}

function endpoint(input: {
  readonly driver: ResolvedCatalogDriver;
  readonly sandbox: SandboxHandle;
}): DriverPrepareRequest['target']['endpoint'] {
  if (input.driver.execution.kind === 'participant') {
    const host = input.driver.target.service;
    const port = input.driver.target.containerPort;
    return {
      kind: 'participant',
      host,
      port,
      url: `${input.driver.target.protocol}://${host}:${port}`,
    };
  }
  const mapped = input.sandbox.endpoints.get(driverEndpointName(input.driver.id));
  if (mapped === undefined) {
    throw new Error(`Sandbox did not expose an endpoint for host driver ${input.driver.id}`);
  }
  return {
    kind: 'host',
    host: mapped.host,
    port: mapped.port,
    url: `${input.driver.target.protocol}://${mapped.host}:${mapped.port}`,
  };
}

function targetEnvironment(input: {
  readonly driver: ResolvedCatalogDriver;
  readonly sandbox: SandboxHandle;
  readonly endpoint: DriverPrepareRequest['target']['endpoint'];
}): Readonly<Record<string, string>> {
  const container = input.sandbox.getContainer({ service: input.driver.target.service });
  // Blackbox owns these coordinate names, so canonical resolved values replace collisions.
  return Object.freeze({
    ...container.testcontainer.environment,
    BLACKBOX_DRIVER_HOST: input.endpoint.host,
    BLACKBOX_DRIVER_PORT: String(input.endpoint.port),
    BLACKBOX_DRIVER_PROTOCOL: input.driver.target.protocol,
    BLACKBOX_DRIVER_SERVICE: input.driver.target.service,
    BLACKBOX_DRIVER_PARTICIPANT: input.driver.target.participantId,
  });
}

export function createDriverPrepareRequest(input: {
  readonly sessionId: string;
  readonly activityId: string;
  readonly driver: ResolvedCatalogDriver;
  readonly argv: readonly [string, ...string[]];
  readonly sandbox: SandboxHandle;
  readonly scope: TelemetryExecutionScope;
}): DriverPrepareRequest {
  const context = input.scope.active.context;
  const resolvedEndpoint = endpoint(input);
  return {
    kind: 'driver-prepare-request',
    protocolVersion: 1,
    driverId: input.driver.id,
    command: { kind: 'command', argv: input.argv },
    target: {
      ...input.driver.target,
      environment: targetEnvironment({
        driver: input.driver,
        sandbox: input.sandbox,
        endpoint: resolvedEndpoint,
      }),
      endpoint: resolvedEndpoint,
    },
    execution: execution(input.driver),
    propagation: input.driver.propagation,
    telemetry: {
      kind: 'w3c-trace-context',
      sessionId: input.sessionId,
      activityId: input.activityId,
      traceparent: context.traceparent,
      tracestate:
        context.traceState.kind === 'trace-state-absent'
          ? { kind: 'absent' }
          : { kind: 'present', value: context.traceState.value },
    },
  };
}
