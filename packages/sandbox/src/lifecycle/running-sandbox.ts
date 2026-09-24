import { asError, SandboxStopError, type RecordWriteOutcome } from './errors.js';
import { cleanupCompose } from './cleanup/compose.js';
import { executeInSandbox } from '../execution/container-exec.js';
import type {
  SandboxResourceInspectionInput,
  SandboxResourceInspectionResult,
} from '../inspection/resources.js';
import { emitLifecycle } from './helpers.js';
import {
  recordedError,
  writeSandboxRecord,
  type ActiveSandboxRecord,
  type FailedSandboxRecord,
} from '../ownership/records.js';
import type {
  SandboxContainer,
  SandboxContainerSelector,
  SandboxEndpoint,
  SandboxExecuteInput,
  SandboxExecuteResult,
  SandboxHandle,
  SandboxInput,
  SandboxLifecycleEvent,
  SandboxTelemetryStatus,
  SandboxStopInput,
  SandboxStopResult,
  StartedComposeSandbox,
} from '../types.js';

interface RunningSandboxInput {
  readonly input: SandboxInput;
  readonly compose: StartedComposeSandbox;
  readonly now: () => Date;
  readonly onEvent: (event: SandboxLifecycleEvent) => void;
  readonly projectName: string;
  readonly endpoints: ReadonlyMap<string, SandboxEndpoint>;
  readonly containers: ReadonlyMap<string, SandboxContainer>;
  readonly resources: SandboxResourceInspectionResult;
  readonly telemetry: SandboxTelemetryStatus;
  readonly record: ActiveSandboxRecord;
}

export class RunningSandbox implements SandboxHandle {
  readonly sandboxId: string;
  readonly projectName: string;
  readonly endpoints: ReadonlyMap<string, SandboxEndpoint>;
  readonly containers: ReadonlyMap<string, SandboxContainer>;
  readonly declaredEnvironment: Readonly<Record<string, string>>;
  readonly telemetry: SandboxTelemetryStatus;
  #state: 'running' | 'stopping' | 'completed' | 'stop-failed' = 'running';
  #stopState:
    | { readonly kind: 'not-started' }
    | { readonly kind: 'started'; readonly promise: Promise<SandboxStopResult> } = {
    kind: 'not-started',
  };
  private record: ActiveSandboxRecord;

  constructor(private readonly options: RunningSandboxInput) {
    this.sandboxId = options.input.sandboxId;
    this.projectName = options.projectName;
    this.endpoints = options.endpoints;
    this.containers = options.containers;
    this.record = options.record;
    this.telemetry = options.telemetry;
    this.declaredEnvironment = Object.freeze({ ...options.input.environment });
  }

  get state(): 'running' | 'stopping' | 'completed' | 'stop-failed' {
    return this.#state;
  }

  getContainer(input: SandboxContainerSelector): SandboxContainer {
    const container = this.containers.get(input.service);
    if (container === undefined) {
      throw new Error(`Container ${input.service} was not explicitly selected or requested`);
    }
    return container;
  }

  inspectResources(input: SandboxResourceInspectionInput): SandboxResourceInspectionResult {
    const kind: 'owned-compose-resources' = input.kind;
    void kind;
    return this.options.resources;
  }

  execute(input: SandboxExecuteInput): Promise<SandboxExecuteResult> {
    return executeInSandbox({
      request: input,
      state: this.#state,
      containers: this.containers,
      compose: this.options.compose,
    });
  }

  inspectTelemetry(): Promise<SandboxTelemetryStatus> {
    return this.options.compose.inspectTelemetry();
  }

  stop(input: SandboxStopInput): Promise<SandboxStopResult> {
    if (this.#stopState.kind === 'started') {
      return this.#stopState.promise;
    }
    const promise = this.performStop(input);
    this.#stopState = { kind: 'started', promise };
    return promise;
  }

  private async performStop(input: SandboxStopInput): Promise<SandboxStopResult> {
    this.#state = 'stopping';
    await this.recordStoppingBestEffort();
    const cleanup = await this.cleanup();
    if (cleanup.kind === 'complete') {
      return this.completeStop(input);
    }
    return this.failStop({ cleanupError: cleanup.error });
  }

  private async recordStoppingBestEffort(): Promise<void> {
    try {
      await this.transition({ state: 'stopping' });
    } catch {
      // The earlier durable record stays discoverable while cleanup proceeds.
    }
  }

  private async cleanup(): Promise<
    { readonly kind: 'complete' } | { readonly kind: 'failed'; readonly error: Error }
  > {
    try {
      await cleanupCompose({
        compose: this.options.compose,
        timeoutMs: this.options.input.stopTimeoutMs,
      });
      return { kind: 'complete' };
    } catch (cause) {
      return { kind: 'failed', error: asError(cause) };
    }
  }

  private async completeStop(input: SandboxStopInput): Promise<SandboxStopResult> {
    const record = {
      ...this.record,
      state: 'completed',
      revision: this.record.revision + 1,
      updatedAt: this.options.now().toISOString(),
      stopReason: input.reason,
      cleanup: 'complete',
    } as const;
    try {
      await writeSandboxRecord({ recordDirectory: this.options.input.recordDirectory, record });
    } catch (cause) {
      this.#state = 'stop-failed';
      throw new SandboxStopError({
        failure: { kind: 'record-failed', recordError: asError(cause) },
      });
    }
    emitLifecycle({ onEvent: this.options.onEvent, record });
    this.#state = 'completed';
    return {
      kind: 'stopped',
      sandboxId: this.sandboxId,
      reason: input.reason,
      cleanup: 'complete',
    };
  }

  private async failStop(input: { readonly cleanupError: Error }): Promise<never> {
    const record = this.failedStopRecord(input);
    const initial = { kind: 'written' } satisfies RecordWriteOutcome;
    let recordOutcome: RecordWriteOutcome = initial;
    try {
      await writeSandboxRecord({ recordDirectory: this.options.input.recordDirectory, record });
      emitLifecycle({ onEvent: this.options.onEvent, record });
    } catch (cause) {
      recordOutcome = { kind: 'failed', error: asError(cause) };
    }
    this.#state = 'stop-failed';
    throw new SandboxStopError({
      failure: { kind: 'cleanup-failed', cleanupError: input.cleanupError, record: recordOutcome },
    });
  }

  private failedStopRecord(input: { readonly cleanupError: Error }): FailedSandboxRecord {
    return {
      ...this.record,
      state: 'stop-failed',
      revision: this.record.revision + 1,
      updatedAt: this.options.now().toISOString(),
      primaryError: recordedError(input.cleanupError),
      cleanup: { kind: 'failed', error: recordedError(input.cleanupError) },
    };
  }

  private async transition(input: { readonly state: ActiveSandboxRecord['state'] }): Promise<void> {
    const next = {
      ...this.record,
      state: input.state,
      revision: this.record.revision + 1,
      updatedAt: this.options.now().toISOString(),
    } satisfies ActiveSandboxRecord;
    await writeSandboxRecord({ recordDirectory: this.options.input.recordDirectory, record: next });
    this.record = next;
    emitLifecycle({ onEvent: this.options.onEvent, record: next });
  }
}
