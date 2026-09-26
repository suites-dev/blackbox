import { join } from 'node:path';
import type { CollectorStorageLease } from '../storage/lease.js';
import type {
  CollectorFailure,
  CollectorLifecycleRecord,
  CollectorRunRecord,
  CollectorStatus,
  ActivateCollectorInput,
  RetainedFragment,
} from '../model/types.js';
import { durableJsonWrite } from '../storage/durable-json.js';
import { fragmentDirectory, fragmentName, lifecyclePath } from '../storage/paths.js';
import { recordedFailure } from '../model/validation.js';
import {
  CollectorRetentionLimitError,
  type CollectorRetentionLimits,
  type CollectorRetentionUsage,
} from './retention.js';

export interface FragmentAcceptance {
  readonly rawJson: string;
  readonly contentEncoding: 'identity' | 'gzip';
  readonly spanCount: number;
}

export interface CollectorStore {
  readonly accept: (input: FragmentAcceptance) => Promise<RetainedFragment>;
  readonly activate: (input: ActivateCollectorInput) => Promise<void>;
  readonly beginDrain: () => Promise<void>;
  readonly finish: (input: {
    readonly timedOut: boolean;
    readonly failure: CollectorFailure | null;
  }) => Promise<void>;
  readonly fail: (error: unknown) => Promise<void>;
  readonly status: () => CollectorStatus;
}

function replaceLastRun(input: {
  readonly record: CollectorLifecycleRecord;
  readonly update: (run: CollectorRunRecord) => CollectorRunRecord;
}): CollectorLifecycleRecord {
  const runs = input.record.runs.map((run, index) =>
    index === input.record.runs.length - 1 ? input.update(run) : run,
  );
  return { ...input.record, revision: input.record.revision + 1, runs };
}

export class RunningCollectorStore implements CollectorStore {
  readonly #lease: CollectorStorageLease;
  #record: CollectorLifecycleRecord;
  #sequence: number;
  #retainedBytes: number;
  #retainedFragments: number;
  readonly #limits: CollectorRetentionLimits;
  #tail: Promise<void> = Promise.resolve();

  public constructor(input: {
    readonly lease: CollectorStorageLease;
    readonly record: CollectorLifecycleRecord;
    readonly sequence: number;
    readonly usage: CollectorRetentionUsage;
    readonly limits: CollectorRetentionLimits;
  }) {
    this.#lease = input.lease;
    this.#record = input.record;
    this.#sequence = input.sequence;
    this.#retainedBytes = input.usage.retainedBytes;
    this.#retainedFragments = input.usage.retainedFragments;
    this.#limits = input.limits;
  }

  public async initialize(): Promise<void> {
    await this.persist();
  }

  public accept(input: FragmentAcceptance): Promise<RetainedFragment> {
    return this.enqueue(async () => {
      const receivedAt = new Date().toISOString();
      const fragment = this.fragment({ ...input, receivedAt });
      const retainedBytes = Buffer.byteLength(`${JSON.stringify(fragment, null, 2)}\n`, 'utf8');
      if (
        this.#retainedFragments + 1 > this.#limits.maxRetainedFragments ||
        this.#retainedBytes + retainedBytes > this.#limits.maxRetainedBytes
      ) {
        throw new CollectorRetentionLimitError(
          'Collector retention limit reached; telemetry intake stopped before writing the fragment.',
        );
      }
      await durableJsonWrite({
        target: join(fragmentDirectory(this.#lease), fragmentName(this.#sequence)),
        token: this.#lease.token,
        value: fragment,
      });
      this.#sequence += 1;
      this.#retainedBytes += retainedBytes;
      this.#retainedFragments += 1;
      await this.update((current) => ({
        ...current,
        revision: current.revision + 1,
        telemetry: {
          status: 'received',
          acceptedRequests: current.telemetry.acceptedRequests + 1,
          acceptedSpans: current.telemetry.acceptedSpans + input.spanCount,
          lastReceivedAt: receivedAt,
        },
      }));
      return fragment;
    });
  }

  public activate(input: ActivateCollectorInput): Promise<void> {
    return this.updateRun((run) => {
      const activatedAt = new Date().toISOString();
      const activation = {
        kind: 'instrumentation-activation' as const,
        runtime: input.runtime,
        serviceName: input.serviceName,
        activatedAt,
      };
      const previous =
        run.instrumentation.kind === 'activated' ? run.instrumentation.activations : [];
      const activations = [
        ...previous.filter(
          (item) => item.runtime !== input.runtime || item.serviceName !== input.serviceName,
        ),
        activation,
      ];
      return {
        ...run,
        instrumentation: { kind: 'activated', activations },
        updatedAt: activatedAt,
      };
    });
  }

  public beginDrain(): Promise<void> {
    return this.updateRun((run) => ({
      ...run,
      receiver: run.receiver === 'failed' ? 'failed' : 'draining',
      shutdown: 'draining',
      updatedAt: new Date().toISOString(),
    }));
  }

  public finish(input: {
    readonly timedOut: boolean;
    readonly failure: CollectorFailure | null;
  }): Promise<void> {
    return this.updateRun((run) => {
      const now = new Date().toISOString();
      const failure = input.failure ?? run.failure;
      return {
        ...run,
        receiver: failure === null ? 'stopped' : 'failed',
        shutdown: input.timedOut ? 'timed-out' : 'complete',
        failure,
        stoppedAt: now,
        updatedAt: now,
      };
    });
  }

  public fail(error: unknown): Promise<void> {
    return this.updateRun((run) => ({
      ...run,
      receiver: 'failed',
      failure: recordedFailure(error),
      updatedAt: new Date().toISOString(),
    }));
  }

  public status(): CollectorStatus {
    const run = this.#record.runs.at(-1);
    if (run === undefined) {
      throw new Error('Collector lifecycle has no active run.');
    }
    return {
      kind: 'collector-status',
      sessionId: this.#record.sessionId,
      executionId: this.#record.executionId,
      instanceId: run.instanceId,
      receiver: run.receiver,
      instrumentation: run.instrumentation,
      telemetry: this.#record.telemetry,
      shutdown: run.shutdown,
      failure: run.failure,
    };
  }

  private fragment(input: FragmentAcceptance & { readonly receivedAt: string }): RetainedFragment {
    return {
      schemaVersion: 1,
      sessionId: this.#lease.sessionId,
      executionId: this.#lease.executionId,
      sequence: this.#sequence,
      receivedAt: input.receivedAt,
      contentType: 'application/json',
      contentEncoding: input.contentEncoding,
      spanCount: input.spanCount,
      rawJson: input.rawJson,
    };
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#tail.then(operation, operation);
    this.#tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private updateRun(change: (run: CollectorRunRecord) => CollectorRunRecord): Promise<void> {
    return this.enqueue(() =>
      this.update((current) => replaceLastRun({ record: current, update: change })),
    );
  }

  private async update(
    change: (current: CollectorLifecycleRecord) => CollectorLifecycleRecord,
  ): Promise<void> {
    this.#record = change(this.#record);
    await this.persist();
  }

  private async persist(): Promise<void> {
    await durableJsonWrite({
      target: lifecyclePath(this.#lease),
      token: `${this.#lease.token}.${String(this.#record.revision)}`,
      value: this.#record,
    });
  }
}
