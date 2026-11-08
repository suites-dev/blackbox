export interface CaptureLease {
  readonly signal: AbortSignal;
  /** Recheck after asynchronous work and immediately before every side effect. */
  check(): void;
}

export interface CaptureOperations {
  check(): void;
  run<T>(operation: (lease: CaptureLease) => Promise<T>, options?: { readonly timeoutMs: number }): Promise<T>;
  close(): Promise<void>;
}

function captureError(error: unknown): Error {
  return error instanceof Error ? error : new Error('Blackbox capture operation failed', { cause: error });
}

function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const aborted = (): void => { reject(captureError(signal.reason)); };
    if (signal.aborted) { aborted(); }
    else { signal.addEventListener('abort', aborted, { once: true }); }
    void work.then(
      (value) => { signal.removeEventListener('abort', aborted); resolve(value); },
      (error: unknown) => { signal.removeEventListener('abort', aborted); reject(captureError(error)); },
    );
  });
}

function timeout(value: number): number {
  if (!Number.isFinite(value) || value < 0) { throw new Error('Capture timeout must be finite and nonnegative'); }
  return value;
}

class Operations implements CaptureOperations {
  private readonly pending = new Set<Promise<void>>();
  private readonly controllers = new Set<AbortController>();
  private readonly failures: unknown[] = [];
  private closing: Promise<void> | null = null;
  private active = true;

  constructor(private readonly timeoutMs: number) {}

  check(): void {
    if (!this.active) { throw new Error('Blackbox capture is closed'); }
  }

  run<T>(operation: (lease: CaptureLease) => Promise<T>, options: Readonly<Partial<{ timeoutMs: number }>> = {}): Promise<T> {
    this.check();
    const controller = new AbortController();
    const lease = { signal: controller.signal, check: () => { controller.signal.throwIfAborted(); this.check(); } } satisfies CaptureLease;
    const duration = options.timeoutMs === undefined ? undefined : timeout(options.timeoutMs);
    const timer = duration === undefined ? undefined : setTimeout(() => {
      controller.abort(new Error('Blackbox capture operation timed out'));
    }, duration);
    this.controllers.add(controller);
    const work = Promise.resolve().then(() => { lease.check(); return operation(lease); })
      .then((value) => { lease.check(); return value; });
    const result = abortable(work, controller.signal).catch((error: unknown) => {
      this.failures.push(error);
      throw error;
    }).finally(() => {
      if (timer !== undefined) { clearTimeout(timer); }
      this.controllers.delete(controller);
    });
    const settled = Promise.allSettled([work, result]).then(() => {
      this.pending.delete(settled);
    });
    this.pending.add(settled);
    return result;
  }

  close(): Promise<void> {
    if (this.closing !== null) { return this.closing; }
    this.active = false;
    for (const controller of this.controllers) {
      controller.abort(new Error('Blackbox capture interrupted during shutdown'));
    }
    this.closing = this.drain();
    return this.closing;
  }

  private async drain(): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        Promise.all([...this.pending]),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => { reject(new Error('Blackbox capture shutdown timed out')); }, this.timeoutMs);
        }),
      ]);
    } catch (error) { this.failures.push(error); }
    finally { if (timer !== undefined) { clearTimeout(timer); } }
    if (this.failures.length > 0) { throw new AggregateError(this.failures, 'Blackbox capture failed'); }
  }
}

/** Close revokes admission immediately, drains owned work within its budget, and retains caught failures. */
export function createCaptureOperations(input: { readonly timeoutMs: number }): CaptureOperations {
  return new Operations(timeout(input.timeoutMs));
}
