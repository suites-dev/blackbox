import { type BehaviorIdentity, canonicalization, type Digest } from '../../envelope/index.js';
import {
  buildReceipt,
  receiptVersion,
  type AttemptReceipt,
  type LifecycleEvent,
  type LifecycleState,
} from './receipt.js';

export interface ReceiptContext {
  readonly receiptId: string;
  readonly retry: number;
  readonly retries: number;
  readonly workerIndex: number;
  readonly parallelIndex: number;
  readonly test: AttemptReceipt['test'];
  readonly catalogEntryId: string;
  readonly invocation: string | null;
}

export interface ReceiptEnd {
  readonly behavior: BehaviorIdentity;
  readonly outcome: AttemptReceipt['outcome'];
  readonly interrupted: boolean;
  readonly envelope: Digest | null;
}

/** Accumulates the lifecycle of one attempt as the fixture moves through it. */
export class ReceiptRecorder {
  readonly #events: LifecycleEvent[] = [];
  #sandboxId: string | null = null;
  #failure: AttemptReceipt['failure'] = null;

  constructor(
    private readonly context: ReceiptContext,
    private readonly clock: () => string = () => new Date().toISOString(),
  ) {
    this.record('scheduled', '');
  }

  private record(state: LifecycleState, detail: string): void {
    this.#events.push({ state, at: this.clock(), detail });
  }

  acquisitionFailed(phase: string, message: string): void {
    this.#failure = { phase, message: message.slice(0, 300) };
    this.record('acquisition-failed', phase);
  }

  started(sandboxId: string): void {
    this.#sandboxId = sandboxId;
    this.record('execution-started', '');
  }

  get acquired(): boolean {
    return this.#sandboxId !== null;
  }

  get failedToAcquire(): boolean {
    return this.#events.some(({ state }) => state === 'acquisition-failed');
  }

  build(end: ReceiptEnd): AttemptReceipt {
    if (this.acquired) {
      this.record(
        end.interrupted ? 'execution-interrupted' : 'execution-completed',
        end.outcome.testStatus,
      );
      if (end.envelope === null) {
        this.record('evidence-unavailable', 'no behavioral envelope was produced');
      }
    }
    const { context } = this;
    return buildReceipt({
      receiptVersion,
      kind: 'attempt-receipt',
      canonicalization,
      attempt: {
        receiptId: context.receiptId,
        retry: context.retry,
        retries: context.retries,
        workerIndex: context.workerIndex,
        parallelIndex: context.parallelIndex,
        sandboxId: this.#sandboxId,
      },
      test: context.test,
      system: { catalogEntryId: context.catalogEntryId },
      behavior: end.behavior,
      invocation: context.invocation,
      lifecycle: this.#events,
      outcome: end.outcome,
      failure: this.#failure,
      envelope: this.acquired ? end.envelope : null,
    });
  }
}
