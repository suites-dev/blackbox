import type { CapsuleInteractiveControl } from '@suites/blackbox-capsule-internal';

type ResolveNext = (result: IteratorResult<CapsuleInteractiveControl>) => void;

export class ControlQueue implements AsyncIterable<CapsuleInteractiveControl> {
  readonly #pending: CapsuleInteractiveControl[] = [];
  readonly #readers: ResolveNext[] = [];
  #closed = false;

  push(control: CapsuleInteractiveControl): void {
    if (this.#closed) {
      return;
    }
    const reader = this.#readers.shift();
    if (reader === undefined) {
      this.#pending.push(control);
      return;
    }
    reader({ done: false, value: control });
  }

  close(): void {
    this.#closed = true;
    for (const reader of this.#readers.splice(0)) {
      reader({ done: true, value: undefined });
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<CapsuleInteractiveControl> {
    return { next: () => this.#next() };
  }

  #next(): Promise<IteratorResult<CapsuleInteractiveControl>> {
    const control = this.#pending.shift();
    if (control !== undefined) {
      return Promise.resolve({ done: false, value: control });
    }
    if (this.#closed) {
      return Promise.resolve({ done: true, value: undefined });
    }
    return new Promise((resolve) => this.#readers.push(resolve));
  }
}
