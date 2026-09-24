import { immutableMap, inspectableContainer } from '../inspection/container.js';
import { immutableResources } from '../inspection/resources.js';
import {
  emitProgress,
  progressCoordinates,
  type SandboxProgressMode,
} from '../acquisition/progress.js';
import { asError, type CleanupOutcome } from './errors.js';
import { composeProjectName, emitLifecycle } from './helpers.js';
import {
  admitSandboxRecord,
  writeSandboxRecord,
  type ActiveSandboxRecord,
} from '../ownership/records.js';
import type {
  SandboxContainer,
  SandboxEndpoint,
  SandboxHandle,
  SandboxInput,
  SandboxRuntimeDependencies,
  SandboxStartInput,
  StartedComposeSandbox,
} from '../types.js';
import { validateSandboxInput } from '../validation/input.js';
import { RunningSandbox } from './running-sandbox.js';
import { failSandboxStart } from './start-failure.js';
import { cleanupCompose } from './cleanup/compose.js';
import { sandboxGeneratedComposeDirectory } from '../telemetry/storage.js';

export class SandboxRuntime {
  constructor(private readonly dependencies: SandboxRuntimeDependencies) {}

  async start(request: SandboxStartInput): Promise<SandboxHandle> {
    const input = request.sandbox;
    await validateSandboxInput(input);
    const record = await this.admit(input);
    emitProgress({
      mode: request.progress,
      event: {
        kind: 'acquisition-started',
        ...progressCoordinates({ source: record, now: this.dependencies.now }),
      },
    });
    let compose: StartedComposeSandbox;
    try {
      compose = await this.dependencies.driver.start({
        projectDirectory: input.projectDirectory,
        composeFiles: input.composeFiles,
        projectName: record.projectName,
        environment: input.environment,
        serviceSelection: input.serviceSelection,
        startupTimeoutMs: input.startupTimeoutMs,
        endpoints: input.endpoints,
        telemetry: input.telemetry,
        generatedComposeDirectory: sandboxGeneratedComposeDirectory(input),
        observation:
          request.progress.kind === 'silent'
            ? { kind: 'silent' }
            : {
                kind: 'events',
                emit: (observation) => {
                  emitProgress({
                    mode: request.progress,
                    event: {
                      kind: 'acquisition-observation',
                      observation,
                      ...progressCoordinates({ source: record, now: this.dependencies.now }),
                    },
                  });
                },
              },
      });
    } catch (cause) {
      return failSandboxStart({
        sandbox: input,
        record,
        cause,
        cleanup: { kind: 'not-attempted' },
        progress: request.progress,
        now: this.dependencies.now,
        onEvent: this.dependencies.onEvent,
      });
    }
    try {
      return await this.finishStart({ input, record, compose, progress: request.progress });
    } catch (cause) {
      const cleanup = await this.cleanupAfterStartFailure({ input, compose });
      return failSandboxStart({
        sandbox: input,
        record,
        cause,
        cleanup,
        progress: request.progress,
        now: this.dependencies.now,
        onEvent: this.dependencies.onEvent,
      });
    }
  }

  private async admit(input: SandboxInput): Promise<ActiveSandboxRecord> {
    const projectName = composeProjectName({ sandboxId: input.sandboxId });
    const admittedAt = this.dependencies.now().toISOString();
    const admitted = {
      schemaVersion: 1,
      sandboxId: input.sandboxId,
      projectName,
      composeFiles: [...input.composeFiles],
      state: 'admitted',
      revision: 0,
      admittedAt,
      updatedAt: admittedAt,
    } satisfies ActiveSandboxRecord;
    await admitSandboxRecord({ recordDirectory: input.recordDirectory, record: admitted });
    emitLifecycle({ onEvent: this.dependencies.onEvent, record: admitted });
    return this.transition({ input, record: admitted, state: 'starting' });
  }

  private async finishStart(input: {
    readonly input: SandboxInput;
    readonly record: ActiveSandboxRecord;
    readonly compose: StartedComposeSandbox;
    readonly progress: SandboxProgressMode;
  }): Promise<SandboxHandle> {
    const containers = this.buildContainers(input);
    emitProgress({
      mode: input.progress,
      event: {
        kind: 'containers-acquired',
        ...progressCoordinates({ source: input.record, now: this.dependencies.now }),
        containers: Object.freeze([...containers.values()]),
      },
    });
    const endpoints = this.buildEndpoints(input);
    const observed = await input.compose.inspectResources({
      kind: 'owned-compose-resources',
      projectName: input.record.projectName,
    });
    const resources = immutableResources({
      projectName: input.record.projectName,
      containers,
      observed,
    });
    const telemetry = await input.compose.inspectTelemetry();
    if (input.input.telemetry.kind === 'enabled' && telemetry.kind !== 'available') {
      throw new Error('Telemetry collector did not become available after Compose startup');
    }
    emitProgress({
      mode: input.progress,
      event: {
        kind: 'resources-ready',
        ...progressCoordinates({ source: input.record, now: this.dependencies.now }),
        resources,
      },
    });
    const record = await this.transition({ ...input, state: 'running' });
    return new RunningSandbox({
      input: input.input,
      compose: input.compose,
      now: this.dependencies.now,
      onEvent: this.dependencies.onEvent,
      projectName: record.projectName,
      endpoints: immutableMap(endpoints),
      containers: immutableMap(containers),
      resources,
      telemetry,
      record,
    });
  }

  private buildEndpoints(input: {
    readonly input: SandboxInput;
    readonly compose: StartedComposeSandbox;
  }): ReadonlyMap<string, SandboxEndpoint> {
    const endpoints = new Map<string, SandboxEndpoint>();
    for (const request of input.input.endpoints) {
      const container = input.compose.getContainer({ service: request.service });
      endpoints.set(
        request.name,
        Object.freeze({
          ...request,
          host: container.host,
          port: container.getMappedPort({ containerPort: request.containerPort }),
        }),
      );
    }
    return endpoints;
  }

  private buildContainers(input: {
    readonly input: SandboxInput;
    readonly compose: StartedComposeSandbox;
  }): ReadonlyMap<string, SandboxContainer> {
    const selection = input.input.serviceSelection;
    const services =
      selection.kind === 'selected' ? selection.services : selection.declaredServices;
    const containers = new Map<string, SandboxContainer>();
    for (const service of services) {
      containers.set(
        service,
        inspectableContainer({
          service,
          container: input.compose.getContainer({ service }),
          endpoints: input.input.endpoints,
        }),
      );
    }
    return containers;
  }

  private async cleanupAfterStartFailure(input: {
    readonly input: SandboxInput;
    readonly compose: StartedComposeSandbox;
  }): Promise<CleanupOutcome> {
    try {
      await cleanupCompose({
        compose: input.compose,
        timeoutMs: input.input.stopTimeoutMs,
      });
      return { kind: 'complete' };
    } catch (cause) {
      return { kind: 'failed', error: asError(cause) };
    }
  }

  private async transition(input: {
    readonly input: SandboxInput;
    readonly record: ActiveSandboxRecord;
    readonly state: ActiveSandboxRecord['state'];
  }): Promise<ActiveSandboxRecord> {
    const next = {
      ...input.record,
      state: input.state,
      revision: input.record.revision + 1,
      updatedAt: this.dependencies.now().toISOString(),
    } satisfies ActiveSandboxRecord;
    await writeSandboxRecord({ recordDirectory: input.input.recordDirectory, record: next });
    emitLifecycle({ onEvent: this.dependencies.onEvent, record: next });
    return next;
  }
}
